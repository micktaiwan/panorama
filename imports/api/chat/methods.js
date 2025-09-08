import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getQdrantUrl } from '/imports/api/_shared/config';

const COLLECTION = () => String(Meteor.settings?.qdrantCollectionName || 'panorama');

const buildSystemPrompt = () => [
  "You are Panorama's assistant. Answer concisely using the provided CONTEXT when relevant.",
  'If the answer is not in the context, answer from general knowledge only if it is safe and obvious; otherwise say you do not know.',
  'Never fabricate citations. Do not execute actions; only answer text for now.'
].join(' ');

const makeContextBlock = (items) => {
  if (!Array.isArray(items) || items.length === 0) return '(no context)';
  const lines = items.map((it, idx) => {
    const head = `S${idx + 1} [${it.kind}] ${it.title || it.text || it.id}`;
    return `${head}\n${it.text || ''}`.trim();
  });
  return lines.join('\n\n');
};

const fetchPreview = async (kind, rawId) => {
  const id = String(rawId || '').split(':').pop();
  switch (kind) {
    case 'project': {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const p = await ProjectsCollection.findOneAsync({ _id: id }, { fields: { name: 1, description: 1 } });
      if (!p) return { title: '(project)', text: '' };
      return { title: p.name || '(project)', text: `${p.name || ''} ${p.description || ''}`.trim() };
    }
    case 'task': {
      const { TasksCollection } = await import('/imports/api/tasks/collections');
      const t = await TasksCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
      return { title: t?.title || '(task)', text: t?.title || '' };
    }
    case 'note': {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      const n = await NotesCollection.findOneAsync({ _id: id }, { fields: { title: 1, content: 1 } });
      return { title: n?.title || '(note)', text: `${n?.title || ''} ${n?.content || ''}`.trim() };
    }
    case 'session': {
      const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
      const s = await NoteSessionsCollection.findOneAsync({ _id: id }, { fields: { name: 1, aiSummary: 1 } });
      return { title: s?.name || '(session)', text: `${s?.name || ''} ${s?.aiSummary || ''}`.trim() };
    }
    case 'line': {
      const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
      const l = await NoteLinesCollection.findOneAsync({ _id: id }, { fields: { content: 1 } });
      return { title: '(line)', text: l?.content || '' };
    }
    case 'alarm': {
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      const a = await AlarmsCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
      return { title: a?.title || '(alarm)', text: a?.title || '' };
    }
    case 'link': {
      const { LinksCollection } = await import('/imports/api/links/collections');
      const l = await LinksCollection.findOneAsync({ _id: id }, { fields: { name: 1, url: 1 } });
      return { title: l?.name || '(link)', text: `${l?.name || ''} ${l?.url || ''}`.trim() };
    }
    default:
      return { title: '(doc)', text: '' };
  }
};

const embedQuery = async (text) => {
  const { embedText } = await import('/imports/api/search/vectorStore');
  return embedText(text);
};

Meteor.methods({
  async 'chat.ask'(payload) {
    const query = String(payload?.query || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (!query) throw new Meteor.Error('bad-request', 'query is required');

    // Vector search (RAG)
    const url = getQdrantUrl();
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    const client = new QdrantClient({ url });
    const vector = await embedQuery(query);
    const searchRes = await client.search(COLLECTION(), { vector, limit: 8, with_payload: true });
    const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
    const sources = [];
    for (let i = 0; i < items.length; i += 1) {
      const p = items[i]?.payload || {};
      const docId = p.docId || null;
      if (!docId) continue;
      const { title, text } = await fetchPreview(p.kind, p.docId);
      sources.push({ id: docId, kind: p.kind, title, text, projectId: p.projectId || null, sessionId: p.sessionId || null, score: items[i]?.score });
    }

    const system = buildSystemPrompt();
    const contextBlock = makeContextBlock(sources.map(s => ({ kind: s.kind, title: s.title, text: s.text, id: s.id })));
    const historyBlock = (history || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const user = [
      `User question: ${query}`,
      '',
      'CONTEXT:',
      contextBlock,
      '',
      (historyBlock ? `History:\n${historyBlock}` : '')
    ].filter(Boolean).join('\n');

    // Log outbound payload (no PII beyond user text)
    console.log('[chat.ask] System:', system);
    console.log('[chat.ask] User:', user);

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        instructions: system,
        input: [ { role: 'user', content: [ { type: 'input_text', text: user } ] } ]
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[chat.ask] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }
    const data = await resp.json();
    const text = data?.output_text || (Array.isArray(data?.output) ? data.output.map(p => p?.content?.[0]?.text || '').join('') : '') || '';
    const citations = sources.map(s => ({ id: s.id, title: s.title, kind: s.kind, projectId: s.projectId, sessionId: s.sessionId }));
    return { text, citations };
  },
});


