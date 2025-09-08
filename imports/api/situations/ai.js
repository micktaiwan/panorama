import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationActorsCollection } from '/imports/api/situationActors/collections';
import { PeopleCollection } from '/imports/api/people/collections';
import { SituationQuestionsCollection } from '/imports/api/situationQuestions/collections';
import { SituationNotesCollection } from '/imports/api/situationNotes/collections';
import { SituationSummariesCollection } from '/imports/api/situationSummaries/collections';
import { getOpenAiApiKey } from '/imports/api/_shared/config';
import { buildKnownPeopleCatalog, buildRosterForQuestions, buildRosterForSummary, buildPriorBlock, buildNotesByActorBlock, extractActorsSchema, generateQuestionsSchema, toOneLine, logOpenAiPayload } from '/imports/api/situations/promptHelpers';

const callOpenAi = async (system, user) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Meteor.Error('missing-openai-key', 'OpenAI API key missing in settings');
  const { default: fetch } = await import('node-fetch');
  try {
    console.log('[situations.callOpenAi] System:', system);
    console.log('[situations.callOpenAi] User:', user);
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'o4-mini', messages: [ { role: 'system', content: system }, { role: 'user', content: user } ] })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[situations.callOpenAi] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
    throw new Meteor.Error('openai-failed', errText);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  console.log('[situations.callOpenAi] Content length:', content.length);
  return content;
  } catch (e) {
    if (!(e instanceof Meteor.Error)) {
      console.error('[situations.callOpenAi] Unexpected error', e);
    }
    throw e;
  }
};

Meteor.methods({
  async 'situations.extractActors'(situationId, situationDescription) {
    check(situationId, String);
    const desc = String(situationDescription || '').trim();
    // Build a compact known-people catalog to guide matching (include ids)
    const knownPeople = await PeopleCollection.find({}, { fields: { name: 1, lastName: 1, aliases: 1, role: 1 } }).fetchAsync();
    const catalogLines = buildKnownPeopleCatalog(knownPeople);
    const system = [
      'Extract a list of actors and their roles in this situation ("situationRole", not their company role ("role")) from the provided situation.',
      'Language: French for roles where appropriate.',
      'Always include personId and situationRole as strings; use empty string ("") when unknown.',
      'Use company roles and aliases from the known roster to disambiguate people with the same name. Prefer returning personId from the provided roster.',
      'Output a strict JSON object matching the provided schema.'
    ].join(' ');
    const user = [
      'Situation description:',
      desc || '(none)'
    ].join('\n');

    const schema = extractActorsSchema;

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('missing-openai-key', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');
    const userContent = [
      user,
      '',
      'Known people (prefer returning personId when available):',
      ...(catalogLines.length > 0 ? catalogLines : ['(none)'])
    ].join('\n');
    logOpenAiPayload('extractActors', system, userContent);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'situation_actors', strict: true, schema } }
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[situations.extractActors] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    console.log('[situations.extractActors] Content:', content);
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) { throw new Meteor.Error('parse-failed', 'Invalid JSON content from model'); }
    const list = Array.isArray(parsed?.actors) ? parsed.actors : [];
    const now = new Date();
    const normalize = (s) => {
      const base = String(s || '').trim().toLowerCase();
      try { return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (_e) { return base; }
    };
    for (const item of list) {
      const personId = item?.personId ? String(item.personId) : '';
      const name = String(item?.name || '').trim();
      const situationRole = String(item?.situationRole || '').trim();
      if (!personId && !name) continue;
      let resolvedPersonId = personId;
      let displayName = name;
      let companyRole = '';
      if (!resolvedPersonId) {
        const np = normalize(name);
        const existingP = await PeopleCollection.findOneAsync({ normalizedName: np });
        if (existingP) {
          resolvedPersonId = existingP._id;
          displayName = [existingP.name || '', existingP.lastName || ''].filter(Boolean).join(' ').trim() || (existingP.name || '');
          companyRole = existingP.role || '';
        } else {
          // create People
          const pId = await PeopleCollection.insertAsync({ name, normalizedName: np, aliases: [], role: '', email: '', notes: '', createdAt: now, updatedAt: now });
          resolvedPersonId = pId;
          displayName = name;
        }
      } else {
        const p = await PeopleCollection.findOneAsync({ _id: resolvedPersonId });
        if (p) {
          displayName = [p.name || '', p.lastName || ''].filter(Boolean).join(' ').trim() || (p.name || '');
          companyRole = p.role || '';
        }
      }
      const existingByPid = await SituationActorsCollection.findOneAsync({ situationId, personId: resolvedPersonId });
      if (existingByPid) {
        const setObj = { updatedAt: now };
        // Always refresh company role snapshot; do not overwrite name or existing situationRole
        setObj.role = companyRole;
        if (!existingByPid.situationRole) {
          setObj.situationRole = situationRole;
        }
        await SituationActorsCollection.updateAsync({ _id: existingByPid._id }, { $set: setObj });
      } else {
        await SituationActorsCollection.insertAsync({ situationId, personId: resolvedPersonId, name: displayName, role: companyRole, situationRole, createdAt: now, updatedAt: now });
      }
    }
    return true;
  },
  async 'situations.generateQuestions'(situationId, situationDescription) {
    check(situationId, String);
    const desc = String(situationDescription || '').trim();
    const actors = await SituationActorsCollection.find({ situationId }, { fields: { name: 1, role: 1, situationRole: 1, personId: 1 } }).fetchAsync();
    // Exclude LEFT people from question generation roster
    const personIds = (actors || []).map(a => a.personId).filter(Boolean);
    const leftDocs = personIds.length > 0
      ? await PeopleCollection.find({ _id: { $in: personIds } }, { fields: { left: 1 } }).fetchAsync()
      : [];
    const leftSet = new Set((leftDocs || []).filter(p => !!p.left).map(p => p._id));
    const activeActors = (actors || []).filter(a => !a.personId || !leftSet.has(a.personId));
    // Load prior questions to include in prompt and to support merging
    const priorDocs = await SituationQuestionsCollection.find({ situationId }).fetchAsync();
    const actorIdToPrior = new Map((priorDocs || []).map(d => [String(d.actorId), Array.isArray(d.questions) ? d.questions : []]));
    // Load notes to attribute context per actor
    const notes = await SituationNotesCollection.find({ situationId }, { sort: { createdAt: -1 } }).fetchAsync();
    const toOneLineLocal = toOneLine;
    const actorIdToNotes = new Map();
    const generalNotes = [];
    for (const n of (notes || [])) {
      const line = toOneLine(n.content || '');
      if (!line) continue;
      if (n.actorId) {
        const key = String(n.actorId);
        const arr = actorIdToNotes.get(key) || [];
        arr.push(line);
        actorIdToNotes.set(key, arr);
      } else {
        generalNotes.push(line);
      }
    }
    const system = [
      'You generate neutral, insightful interview questions per actor.',
      'Language: French. Use tutoiement ("tu"), never vouvoiement.',
      'Tone: neutral, non-blaming, focused on understanding and improvements.',
      'Output a strict JSON object matching the provided schema. The field personId is REQUIRED for every item and MUST be one of the roster ids.',
      'When considering context, use situationRole (role specific to this situation), not the company title.',
      'Important: For each question object, set r to an empty string ("") — do NOT provide any suggested reply, rationale, or hint in r.'
    ].join(' ');
    const roster = buildRosterForQuestions(activeActors);
    // Render prior Q/R for context
    const renderPrior = () => buildPriorBlock(activeActors, actorIdToPrior);
    const renderNotesByActor = () => buildNotesByActorBlock(activeActors, actorIdToNotes, generalNotes);
    const user = [
      'Situation description:',
      desc || '(none)',
      '',
      'Roster (RETURN personId for each item; ids must come from this list; roles included for disambiguation):',
      ...(roster.length > 0 ? roster : ['- none']),
      '',
      'Prior questions and replies (per actor):',
      renderPrior(),
      '',
      'Notes by actor (use personId to disambiguate):',
      renderNotesByActor(),
      '',
      'Generate 5–7 questions per actor.'
    ].join('\n');

    const schema = generateQuestionsSchema;

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('missing-openai-key', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');
    logOpenAiPayload('generateQuestions', system, user);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        response_format: { type: 'json_schema', json_schema: { name: 'situation_questions', strict: true, schema } }
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[situations.generateQuestions] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    console.log('[situations.generateQuestions] Content:', content);
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) { throw new Meteor.Error('parse-failed', 'Invalid JSON content from model'); }
    const list = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of list) {
      let actor = null;
      if (item.personId) actor = activeActors.find(a => a.personId === item.personId);
      if (!actor) {
        const actorName = String(item.actor || '').trim();
        actor = activeActors.find(a => String(a.name || '').trim().toLowerCase() === actorName.toLowerCase());
      }
      if (!actor) continue;
      const qs = Array.isArray(item.questions)
        ? item.questions
            .map(q => {
              if (typeof q === 'string') return { q: String(q || '').trim(), r: '' };
              if (q && typeof q === 'object' && 'q' in q) {
                return { q: String(q.q || '').trim(), r: '' };
              }
              return null;
            })
            .filter(x => x && x.q)
        : [];
      if (qs.length === 0) continue;
      const now = new Date();
      const existing = await SituationQuestionsCollection.findOneAsync({ situationId, actorId: actor._id });
      if (existing) {
        const existingQs = Array.isArray(existing.questions) ? existing.questions : [];
        const norm = (s) => {
          const base = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
          try { return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (_e) { return base; }
        };
        const seen = new Set(existingQs.map(x => norm(x.q)));
        const additions = qs.filter(x => !seen.has(norm(x.q)));
        const merged = existingQs.concat(additions);
        await SituationQuestionsCollection.updateAsync({ _id: existing._id }, { $set: { questions: merged, createdAt: now } });
      } else {
        await SituationQuestionsCollection.insertAsync({ situationId, actorId: actor._id, questions: qs, createdAt: now });
      }
    }
    return true;
  },

  async 'situations.generateSummary'(situationId, situationDescription, notesMarkdown) {
    check(situationId, String);
    const desc = String(situationDescription || '').trim();
    const notes = String(notesMarkdown || '').trim();
    // Build contextual blocks by actor (people-linked) for clarity
    const actors = await SituationActorsCollection.find({ situationId }, { fields: { name: 1, personId: 1, role: 1 } }).fetchAsync();
    const allNotes = await SituationNotesCollection.find({ situationId }, { sort: { createdAt: -1 } }).fetchAsync();
    const priorDocs = await SituationQuestionsCollection.find({ situationId }).fetchAsync();
    const actorIdToPrior = new Map((priorDocs || []).map(d => [String(d.actorId), Array.isArray(d.questions) ? d.questions : []]));
    const toOneLine2 = toOneLine;
    const actorIdToNotes = new Map();
    const generalNotes = [];
    for (const n of (allNotes || [])) {
      const line = toOneLine(n.content || '');
      if (!line) continue;
      if (n.actorId) {
        const key = String(n.actorId);
        const arr = actorIdToNotes.get(key) || [];
        arr.push(line);
        actorIdToNotes.set(key, arr);
      } else {
        generalNotes.push(line);
      }
    }
    const roster = buildRosterForSummary(actors);
    const renderNotesByActor = () => buildNotesByActorBlock(actors, actorIdToNotes, generalNotes);
    const renderPrior = () => {
      const blocks = [];
      for (const a of actors) {
        const qs = actorIdToPrior.get(String(a._id)) || [];
        if (!qs.length) continue;
        const header = `Questions/Réponses — ${a.personId ? a.personId : ''} — ${a.name || ''}`.trim();
        const lines = qs.map(q => `Q: ${q.q || ''}${(q.r && q.r.trim()) ? ` | R: ${q.r.trim()}` : ''}`);
        blocks.push([header, ...lines].join('\n'));
      }
      return blocks.length > 0 ? blocks.join('\n\n') : '(none)';
    };
    const system = [
      'You write a summary and an action plan. Output must be in French.',
      'Style: simple sentences, clear, no jargon; explain and popularize.',
      'No Markdown. No tables. Plain text only.'
    ].join(' ');
    const user = [
      'Situation content:',
      desc || '(no description)',
      '',
      'Roster (personId — Name for disambiguation):',
      ...(roster.length > 0 ? roster : ['- none']),
      '',
      'Notes by actor:',
      renderNotesByActor(),
      '',
      'Prior questions/answers by actor:',
      renderPrior(),
      '',
      'Additional general notes (from UI):',
      notes || '(no notes)',
      '',
      'Guidelines (plain text, write in French):',
      '1) Summary — 4 to 8 sentences, pedagogical, no jargon.',
      '2) Problems analysis — 3 to 5 short paragraphs; for each problem, describe:',
      '   the problem, its causes, the impacts, and pragmatic avenues to try. No tables. No pipe "|" formatting.',
      '3) Action plan — 3 to 5 actions; one line per action, starting with a verb (e.g., Mettre en place…, Mesurer…, Former…).'
    ].join('\n');
    const text = await callOpenAi(system, user);
    const existing = await SituationSummariesCollection.findOneAsync({ situationId });
    const now = new Date();
    if (existing) await SituationSummariesCollection.updateAsync({ _id: existing._id }, { $set: { text, createdAt: now } });
    else await SituationSummariesCollection.insertAsync({ situationId, text, createdAt: now });
    return { text };
  }
});


