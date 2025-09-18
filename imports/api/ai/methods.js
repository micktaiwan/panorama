import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey } from '/imports/api/_shared/config';
import { check } from 'meteor/check';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';

// Normalize multi-line text to a single line
const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Shared helpers for AI calls
const OPENAI_MODEL = 'o4-mini';

const pad2 = (n) => String(n).padStart(2, '0');

const localIsoWithOffset = (d) => {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${hh}:${mm}`;
};

const formatAnchors = (now, since) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const nowLocalIso = localIsoWithOffset(now);
  const sinceLocalIso = localIsoWithOffset(since);
  const startLocal = `${pad2(since.getHours())}:${pad2(since.getMinutes())}`;
  const endLocal = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return { tz, sinceLocalIso, nowLocalIso, startLocal, endLocal };
};

const buildEntriesBlock = (logs) => (logs || []).map(l => {
  const iso = new Date(l.createdAt).toISOString();
  return `- { id: ${l._id} } [${iso}] ${toOneLine(l.content || '')}`;
}).join('\n');

const buildProjectsBlock = (catalog) => catalog.map(p => `- { id: ${p.id}, name: ${p.name}${p.description ? `, desc: ${p.description}` : ''} }`).join('\n');

async function openAiChat({ system, user, expectJson, schema }) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
  const { default: fetch } = await import('node-fetch');
  const body = expectJson
    ? { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], response_format: { type: 'json_schema', json_schema: { name: 'userlog_summary', strict: false, schema } } }
    : { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ] };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[openAiChat] request failed', { status: resp.status, statusText: resp.statusText, body: errText });
    throw new Meteor.Error('openai-failed', errText);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || (expectJson ? '{}' : '');
  if (!expectJson) return String(content || '');
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error('[openAiChat] invalid JSON', { content, error: err && err.message });
    throw new Meteor.Error('openai-invalid-json', 'Invalid JSON content from model');
  }
}

const buildPrompt = ({ project, lines: noteLines }) => {
  const head = [
    'You are an assistant that summarizes CTO meeting notes into Decisions, Risks, Next steps.',
    'Use ONLY the provided notes. Do not invent facts. If a section has no factual content, write "No items."',
    'Return markdown with headings (## Decisions, ## Risks, ## Next steps).',
    'Use short bullet points. Use exactly one blank line between sections and no extra blank lines inside sections.',
    'Each bullet MUST include citations to source lines in square brackets, e.g., [L3] or [L2,L5].'
  ].join(' ');
  const context = project
    ? `\nProject: ${project.name || ''}${project.description ? ` — ${toOneLine(project.description)}` : ''} | Status: ${project.status || ''} | Target: ${project.targetDate || ''}`
    : '';
  const numbered = noteLines.map((l, idx) => `L${idx + 1}: ${l.content}`);
  const body = `\nNotes (numbered):\n${numbered.join('\n')}`;
  return `${head}${context}${body}`;
};

const buildCoachPrompt = ({ project }) => {
  const head = 'You are a CTO project coach.';
  const rules = [
    'Your goals:',
    '- Ask concise, high-signal questions to reduce risk and improve clarity.',
    '- Propose concrete, actionable ideas/suggestions when helpful.',
    '- If the notes contain explicit questions, provide concise answers.',
    'Constraints:',
    '- Use ONLY the provided notes. Do not invent facts.',
    '- Ground every item with citations to L1..Ln when possible.',
    'Output format:',
    '- Return a JSON object with three arrays: { questions: [], ideas: [], answers: [] }.',
    '- Each array item is { text: string, cites: number[] } (cites refer to note line numbers like 1,2,3 for L1..Ln).',
    '- If a section has no content, return an empty array for that section.',
    '- Only propose NEW items; do not repeat or rephrase previously asked or suggested ones.'
  ].join(' ');
  const context = project
    ? `\nProject: ${project.name || ''}${project.description ? ` — ${toOneLine(project.description)}` : ''} | Status: ${project.status || ''} | Target: ${project.targetDate || ''}`
    : '';
  // Numbering is handled by the caller when building the notes block
  const body = `\nNotes: will be provided as numbered lines (L1..Ln) in the user message.`;
  return `${head}\n${rules}${context}${body}`;
};

Meteor.methods({
  async 'ai.textToTasksAnalyze'(inputText) {
    check(inputText, String);

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    }

    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();

    const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    const catalog = projects
      .filter(p => !!p.name)
      .map(p => ({ name: toOneLine(p.name), description: toOneLine(p.description) }));

    const system = 'You convert free-form text into structured projects and tasks. Output JSON only.';
    const now = new Date();
    const nowIso = now.toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const instructions = [
      'Rules:',
      `Current date/time: ${nowIso} (${tz})`,
      '- Use the provided JSON schema strictly. No extra fields.',
      '- Map tasks to an existing project name when appropriate; else propose a new project.',
      '- Extract clear action titles; include optional notes and an ISO deadline (YYYY-MM-DD).',
      '- If the calculated date is before today, omit the deadline.',
      '',
      'Project definition:',
      '- A project is a durable container of multiple related tasks over time (weeks or more) with a clear goal or scope.',
      '- A project is NOT a one-off task (e.g., "CR Charles / Corentin", "Sign papers", "Buy adapter").',
      '',
      'Name and creation policy:',
      '- Prefer mapping to an EXISTING project when any synonym/alias matches case-insensitively.',
      '- Only propose a NEW project if its name is clearly present in the user text as an initiative/product/team AND either (a) at least two distinct tasks map to this same new theme, or (b) it is clearly an ongoing initiative.',
      '- Do NOT create generic/bucket/ephemeral projects (e.g., "Weekend Tasks", "Admin", "Misc", tool names from links like "BasicMemory") unless they satisfy the rule above.',
      '- Normalize names (short, specific nouns) and deduplicate close variants into a single project name (e.g., "Vibe Code dev" → "Vibe Code").',
      '',
      'Project mapping policy (critical):',
      '- The list below contains EXISTING project names. Match case-insensitively to these names.',
      '- Do NOT include existing projects in the top-level "projects" array. That array MUST contain only new projects to create.',
      '- If a task does not map to an existing project name, set projectSuggestion.matchType = "new" and provide a concise proposed name.',
      '- Avoid using "unknown" unless it is truly impossible to infer a project. Never use placeholders like "Unknown".',
      '- Do not propose generic buckets unless they are present in the provided list (e.g., do not invent "General" if not listed).',
      '',
      'Existing projects (name — short description):',
      ...catalog.map(p => `- ${p.name}${p.description ? ` — ${p.description}` : ''}`),
      '',
      'User text:',
      inputText
    ].join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        projects: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          }
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              notes: { type: 'string' },
              deadline: { type: 'string' },
              sourceLine: { type: 'string' },
              projectSuggestion: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  matchType: { type: 'string', enum: ['existing', 'new', 'unknown'] },
                  name: { type: 'string' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['matchType', 'name', 'confidence']
              }
            },
            required: ['title', 'projectSuggestion']
          }
        }
      },
      required: ['projects', 'tasks']
    };

    const { default: fetch } = await import('node-fetch');

    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'o4-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: instructions }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'text2tasks', strict: false, schema }
          }
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[ai.textToTasksAnalyze] OpenAI request failed', { status: resp.status, statusText: resp.statusText, body: errText });
        throw new Meteor.Error('openai-failed', errText);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        console.error('[ai.textToTasksAnalyze] Invalid JSON content from model', { content, error: err && err.message });
        throw new Meteor.Error('openai-invalid-json', 'Invalid JSON content from model');
      }
      if (!parsed.projects) parsed.projects = [];
      if (!parsed.tasks) parsed.tasks = [];

      // Post-process to enforce mapping rules: only new projects in projects[],
      // and convert non-matching suggestions to matchType 'new' with a name.
      try {
        const existingNamesLc = new Set(catalog.map(p => p.name.toLowerCase()));
        const newProjectsSet = new Set();
        const normalizeName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

        // Clean incoming projects: keep only new ones that are not in existing
        const incomingProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
        for (const p of incomingProjects) {
          const name = normalizeName(p && p.name);
          if (!name) continue;
          if (!existingNamesLc.has(name.toLowerCase())) newProjectsSet.add(name);
        }

        // Walk tasks and normalize projectSuggestion
        const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        for (const t of tasksArr) {
          if (!t || !t.projectSuggestion) {
            t.projectSuggestion = { matchType: 'unknown', name: '', confidence: 0 };
          }
          const ps = t.projectSuggestion;
          ps.name = normalizeName(ps.name);
          const inExisting = ps.name && existingNamesLc.has(ps.name.toLowerCase());
          if (inExisting) {
            ps.matchType = 'existing';
          } else {
            // If not existing and we have a usable name, mark as new; avoid Unknown
            if (ps.name && ps.name.toLowerCase() !== 'unknown') {
              ps.matchType = 'new';
              newProjectsSet.add(ps.name);
            } else {
              ps.matchType = 'unknown';
            }
          }
        }

        parsed.projects = Array.from(newProjectsSet).map(name => ({ name }));
      } catch (err) {
        console.error('[ai.textToTasksAnalyze] Post-process mapping error', { error: err && err.message });
      }
      try {
        const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];

        // Count suggestion types and matching to existing project names
        const existingNames = new Set((catalog || []).map(p => String(p.name || '').trim().toLowerCase()));
        const suggestionCounts = { existing: 0, new: 0, unknown: 0, missing: 0 };
        // track of matchedExistingCount removed to reduce log noise
        const unmatchedSamples = [];
        for (const t of tasksArr) {
          const ps = t && t.projectSuggestion;
          if (!ps || !ps.matchType) {
            suggestionCounts.missing += 1;
            continue;
          }
          if (ps.matchType === 'existing') suggestionCounts.existing += 1;
          else if (ps.matchType === 'new') suggestionCounts.new += 1;
          else suggestionCounts.unknown += 1;
          const nameLc = ps && ps.name ? String(ps.name).trim().toLowerCase() : '';
          if (nameLc && existingNames.has(nameLc)) {
            
          } else if (nameLc) {
            if (unmatchedSamples.length < 5) unmatchedSamples.push({ title: t.title, suggested: ps.name });
          }
        }

        
      } catch (err) {
        console.error('[ai.textToTasksAnalyze] Error processing parsed content', { error: err && err.message });
      }
      return parsed;
    } catch (err) {
      if (!(err instanceof Meteor.Error)) {
        console.error('[ai.textToTasksAnalyze] Unexpected error', err);
        throw new Meteor.Error('ai-text2tasks-failed', err.message || String(err));
      }
      throw err;
    }
  },
  async 'ai.summarizeSession'(sessionId) {
    check(sessionId, String);

    const session = await NoteSessionsCollection.findOneAsync({ _id: sessionId });
    if (!session) {
      throw new Meteor.Error('not-found', 'Session not found');
    }

    const lines = await NoteLinesCollection.find({ sessionId }).fetchAsync();
    if (!lines || lines.length === 0) {
      throw new Meteor.Error('no-lines', 'Cannot summarize an empty session. Add some note lines first.');
    }
    const project = session.projectId ? await import('/imports/api/projects/collections').then(m => m.ProjectsCollection.findOneAsync({ _id: session.projectId })) : null;

    const prompt = buildPrompt({ project, lines });

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    }

    // Lazy import to avoid client bundling
    const { default: fetch } = await import('node-fetch');
    // Structured JSON output with citations
    const numbered = lines.map((l, idx) => `L${idx + 1}: ${l.content}`);
    const system = 'You summarize CTO project meeting notes strictly from provided content.';
    const instructions = [
      'Use ONLY the provided notes. Do not invent facts.',
      'Return a JSON object with fields: summary, decisions, risks, nextSteps.',
      'summary is a concise paragraph (3-6 sentences) capturing the essence of the discussion.',
      'Each of decisions/risks/nextSteps is an array of items: { text: string, cites: number[] } where cites are line numbers like 1,2,3 referring to L1..Ln.',
      'If a section has no content, return an empty array for that section (summary must not be empty).'
    ].join(' ');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        },
        nextSteps: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        }
      },
      required: ['summary', 'decisions', 'risks', 'nextSteps']
    };

    // Log final prompt messages for visibility
    const userContent = `${instructions}\n\nNotes (numbered):\n${numbered.join('\n')}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'session_summary', strict: false, schema } }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ai.summarizeSession] OpenAI request failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const json = JSON.parse(content);

    const toSection = (title, arr) => {
      if (!arr || arr.length === 0) return '';
      const bullets = arr.map(item => {
        const cites = Array.isArray(item.cites) && item.cites.length > 0 ? ` [${item.cites.map(n => `L${n}`).join(',')}]` : '';
        return `- ${item.text}${cites}`;
      }).join('\n');
      return `## ${title}\n\n${bullets}`;
    };

    const summaryText = typeof json.summary === 'string' && json.summary.trim() ? json.summary.trim() : '';
    const sections = [
      (summaryText ? `## Summary\n\n${summaryText}` : ''),
      toSection('Decisions', json.decisions),
      toSection('Risks', json.risks),
      toSection('Next steps', json.nextSteps)
    ].filter(Boolean);
    const md = sections.join('\n\n');

    await NoteSessionsCollection.updateAsync(sessionId, { $set: { aiSummary: md, aiSummaryJson: json, aiSummaryAt: new Date(), aiPrompt: prompt } });
    return { aiSummary: md };
  },
  async 'ai.coachQuestions'(sessionId) {
    check(sessionId, String);

    const session = await NoteSessionsCollection.findOneAsync({ _id: sessionId });
    if (!session) throw new Meteor.Error('not-found', 'Session not found');

    const lines = await NoteLinesCollection.find({ sessionId }).fetchAsync();
    const project = session.projectId ? await import('/imports/api/projects/collections').then(m => m.ProjectsCollection.findOneAsync({ _id: session.projectId })) : null;

    const prompt = buildCoachPrompt({ project, lines });

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');

    // Build numbered notes from all session lines
    const numbered = lines.map((l, idx) => `L${idx + 1}: ${l.content}`);
    // Build previous coach context (questions, ideas, answers)
    const prevQuestions = Array.isArray(session.coachQuestionsJson) && session.coachQuestionsJson.length > 0
      ? session.coachQuestionsJson
      : (Array.isArray(session.coachQuestions) && session.coachQuestions.length > 0
        ? session.coachQuestions.map(q => ({ text: q, cites: [] }))
        : []);
    const prevIdeas = Array.isArray(session.coachIdeasJson) ? session.coachIdeasJson : [];
    const prevAnswers = Array.isArray(session.coachAnswersJson) ? session.coachAnswersJson : [];
    const renderPrev = (arr) => (arr?.length > 0)
      ? arr.map((q, i) => {
          const cites = Array.isArray(q.cites) && q.cites.length > 0 ? ` [${q.cites.join(',')}]` : '';
          return `${i + 1}. ${q.text}${cites}`;
        }).join('\n')
      : '(none)';
    const previousQuestionsBlock = renderPrev(prevQuestions);
    const previousIdeasBlock = renderPrev(prevIdeas);
    const previousAnswersBlock = renderPrev(prevAnswers);

    // OpenAI structured outputs prefer an object root; wrap outputs in object fields
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        },
        ideas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              cites: { type: 'array', items: { type: 'integer', minimum: 1 } }
            },
            required: ['text', 'cites']
          }
        }
      },
      required: ['questions', 'ideas', 'answers']
    };

    // Build final system and user contents once and log them
    const systemContent = 'You are a CTO project coach. Ask concise, high-signal questions, propose concrete ideas/suggestions, and if the notes contain explicit questions, provide concise answers. Ground everything strictly in the provided notes. Only propose NEW items; do not repeat or rephrase previously asked or suggested ones.';
    const userContent = `${prompt}\n\nPrevious coach items (for context; avoid duplicates):\nQuestions:\n${previousQuestionsBlock}\n\nIdeas:\n${previousIdeasBlock}\n\nAnswers:\n${previousAnswersBlock}\n\nNotes (numbered):\n${numbered.join('\n')}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'coach_questions', strict: true, schema } }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ai.coachQuestions] OpenAI request failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('[ai.coachQuestions] Invalid JSON content from model', { content, error: err && err.message });
      throw new Meteor.Error('openai-invalid-json', 'Invalid JSON content from model');
    }
    const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
    // Store strings for UI compatibility
    const coachQuestions = qs.map(it => it.text);

    await NoteSessionsCollection.updateAsync(sessionId, { $set: {
      coachQuestions,
      coachQuestionsJson: qs,
      coachIdeasJson: ideas,
      coachAnswersJson: answers,
      coachAt: new Date(),
      coachPrompt: prompt
    } });
    return { coachQuestions, ideasCount: ideas.length, answersCount: answers.length };
  },
  async 'ai.cleanNote'(noteId) {
    check(noteId, String);

    const { NotesCollection } = await import('/imports/api/notes/collections');
    const note = await NotesCollection.findOneAsync({ _id: noteId });
    if (!note) throw new Meteor.Error('not-found', 'Note not found');

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');

    const original = typeof note.content === 'string' ? note.content : '';
    if (!original.trim()) {
      return { content: original };
    }

    const { default: fetch } = await import('node-fetch');

    const system = 'You clean and normalize note text without summarizing or translating.';
    const instructions = [
      'This is a note. Remove emojis. Remove formatting, remove time stamps like "2 minutes ago" or "9:14"',
      'Keep a text format and put sections titles if needed',
      'Keep conversation flow and names if it is a conversation',
      'Do not lose content, do not summarize.',
      'Keep the same language as the original note.',
      'You can fix spelling errors.'
    ].join(' ');
    const user = `${instructions}\n\nOriginal note:\n\n\u0060\u0060\u0060\n${original}\n\u0060\u0060\u0060`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ai.cleanNote] OpenAI request failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }

    const data = await resp.json();
    const cleaned = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? String(data.choices[0].message.content) : '';

    // Persist cleaned content
    await NotesCollection.updateAsync(noteId, { $set: { content: cleaned, updatedAt: new Date() } });

    // Update search vector and project updatedAt
    try {
      const next = await NotesCollection.findOneAsync(noteId, { fields: { title: 1, content: 1, projectId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'note', id: noteId, text: `${next?.title || ''} ${next?.content || ''}`.trim(), projectId: next?.projectId || null });
      if (next && next.projectId) {
        const { ProjectsCollection } = await import('/imports/api/projects/collections');
        await ProjectsCollection.updateAsync(next.projectId, { $set: { updatedAt: new Date() } });
      }
    } catch (err) {
      console.error('[ai.cleanNote] post-update side effects failed', err);
    }

    return { content: cleaned };
  }
  ,
  async 'ai.cleanUserLog'(logId) {
    check(logId, String);

    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
    const entry = await UserLogsCollection.findOneAsync({ _id: logId });
    if (!entry) throw new Meteor.Error('not-found', 'UserLog entry not found');

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');

    const original = typeof entry.content === 'string' ? entry.content : '';
    if (!original.trim()) {
      return { content: original };
    }

    const { default: fetch } = await import('node-fetch');

    const system = 'You fix spelling and basic grammar without changing meaning or tone.';
    const instructions = [
      'This is a short journal entry. Do not summarize or translate.',
      'Keep the same language as the original.',
      'Fix obvious spelling and simple grammar issues. Keep emojis as-is.',
      'Return the corrected text only.'
    ].join(' ');
    const user = `${instructions}\n\nOriginal entry:\n\n\u0060\u0060\u0060\n${original}\n\u0060\u0060\u0060`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ai.cleanUserLog] OpenAI request failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }

    const data = await resp.json();
    const cleaned = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? String(data.choices[0].message.content) : '';

    await UserLogsCollection.updateAsync(logId, { $set: { content: cleaned, updatedAt: new Date() } });
    return { content: cleaned };
  },
  async 'userLogs.summarizeWindow'(windowKey, hours, options) {
    check(windowKey, String);
    const n = Number(hours);
    const promptOverride = (typeof options === 'string') ? options : (options && typeof options.promptOverride === 'string' ? options.promptOverride : '');
    const rangeHours = Number.isFinite(n) && n > 0 ? n : 3;

    const now = new Date();
    const since = new Date(now.getTime() - rangeHours * 3600 * 1000);

    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
    const logs = await UserLogsCollection.find({ createdAt: { $gte: since } }, { sort: { createdAt: 1 } }).fetchAsync();

    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();

    const catalog = projects
      .filter(p => !!p.name)
      .map(p => ({ id: p._id, name: toOneLine(p.name), description: toOneLine(p.description) }));

    const { tz, sinceLocalIso, nowLocalIso, startLocal, endLocal } = formatAnchors(now, since);

    const system = ([
      'You analyze short journal entries and produce: (1) a structured summary organized by subject, (2) task suggestions.',
      'Do NOT invent facts. Use the provided entries only. Keep original language (typically French).',
      'Return STRICT JSON matching the provided schema. No Markdown, no extra text.',
      'Time policy: When mentioning times, format them in 24-hour local time as HH:mm. Only include a calendar date if it is not today, and format it human-readably (e.g., 12 Sep 2025). Never output raw ISO timestamps or timezone offsets in the summary.'
    ].join(' '));

    const entriesBlock = buildEntriesBlock(logs);
    const projectsBlock = buildProjectsBlock(catalog);

    const instructions = [
      `Timezone (IANA): ${tz}`,
      `Now (local): ${nowLocalIso}`,
      `Since (local): ${sinceLocalIso}`,
      `Time window: last ${rangeHours} hours (inclusive)`,
      '',
      'Available projects (id, name, desc):',
      projectsBlock || '(none)',
      '',
      'Journal entries in chronological order (each with an id). Use their times, but when you mention them, format as HH:mm (24h local). Do not output ISO strings:',
      entriesBlock || '(none)',
      '',
      'Output policy for tasks (critical):',
      '- Every task suggestion that is grounded in one or more journal entries MUST include sourceLogIds with the matching entry ids.',
      '- If no grounding is possible, omit that suggestion instead of inventing.',
      '- Prefer fewer, well-grounded suggestions over many weak ones.'
    ].join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              notes: { type: 'string' },
              projectId: { type: 'string' },
              deadline: { type: 'string' },
              sourceLogIds: { type: 'array', items: { type: 'string' } }
            },
            required: ['title', 'projectId', 'sourceLogIds']
          }
        }
      },
      required: ['summary', 'tasks']
    };

    // If a custom prompt override is provided, ignore the default prompt and schema.
    // Send only the override instruction and the journal entries; return plain text.
    let parsed;
    if (promptOverride && promptOverride.trim()) {
      const customSystem = [
        'You receive a user instruction and journal entries as context.',
        'Follow the instruction strictly using ONLY the provided entries. Do not invent facts.',
        'Respond in plain text (no JSON). Keep the original language when possible.',
        'Time policy: When mentioning times, format them in 24-hour local time as HH:mm. Only include a calendar date if it is not today, and format it human-readably (e.g., 12 Sep 2025). Never output raw ISO timestamps or timezone offsets.'
      ].join(' ');
      const customUser = [
        `Instruction: ${promptOverride.trim()}`,
        '',
        `Timezone (IANA): ${tz}`,
        `Now (local): ${nowLocalIso}`,
        `Since (local): ${sinceLocalIso}`,
        `Time window: last ${rangeHours} hours (inclusive)`,
        '',
        'Journal entries in chronological order (each with an id). Use their times, but when you mention them, format as HH:mm (24h local). Do not output ISO strings:',
        entriesBlock || '(none)'
      ].join('\n');
      

      const content = await openAiChat({ system: customSystem, user: customUser, expectJson: false });
      parsed = { summary: String(content || '').trim(), tasks: [] };
    } else {
      // Default behavior: structured JSON with summary and task suggestions
      

      const json = await openAiChat({ system, user: instructions, expectJson: true, schema });
      parsed = json;
      if (!parsed.tasks) parsed.tasks = [];
    }

    
    // Ensure window is present; if not, inject our anchors
    if (!parsed.window || typeof parsed.window !== 'object') {
      parsed.window = { tz, sinceIso: sinceLocalIso, nowIso: nowLocalIso, startLocal, endLocal };
    }
    return parsed;
  }
});

// Project improvement helpers
Meteor.methods({
  async 'ai.project.improvementQuestions'(projectId) {
    check(projectId, String);
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const project = await ProjectsCollection.findOneAsync({ _id: projectId });
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    const name = String(project.name || '').trim();
    const desc = String(project.description || '').trim();

    const system = 'You are a product discovery assistant. Ask clarifying questions to improve a project description.';
    const user = [
      'Given the project below, ask up to 6 high-signal questions that would help clarify scope, outcomes, constraints, and first steps.',
      'Keep questions concise and concrete. Use the same language as the user content when possible (often French).',
      'Return STRICT JSON matching the schema.',
      '',
      `Project name: ${name || '(untitled)'}`,
      `Current description: ${desc || '(empty)'}`
    ].join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        questions: { type: 'array', items: { type: 'string' }, maxItems: 6 }
      },
      required: ['questions']
    };

    const json = await openAiChat({ system, user, expectJson: true, schema });
    const qs = Array.isArray(json?.questions) ? json.questions.filter(q => typeof q === 'string' && q.trim()) : [];
    return { questions: qs };
  },

  async 'ai.project.applyImprovement'(projectId, payload) {
    check(projectId, String);
    check(payload, Object);
    const answers = Array.isArray(payload.answers) ? payload.answers.map(a => String(a || '')) : [];
    const freeText = typeof payload.freeText === 'string' ? payload.freeText : '';

    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const project = await ProjectsCollection.findOneAsync({ _id: projectId });
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    const name = String(project.name || '').trim();
    const desc = String(project.description || '').trim();

    const system = 'You improve project descriptions and propose initial actionable tasks.';
    const rules = [
      'Return STRICT JSON using the provided schema. No Markdown.',
      'Language: respond in the same language as the user inputs and project description (often French).',
      'Improved description should APPEND to the existing description, not replace it. Provide only the appended paragraph(s), not the full description.',
      'Task suggestions must be concrete, short, and feasible as first steps (3–8 items). Do not invent deadlines.'
    ].join(' ');

    const user = [
      rules,
      '',
      `Project name: ${name || '(untitled)'}`,
      `Current description: ${desc || '(empty)'}`,
      '',
      'User answers to clarifying questions (free text merged):',
      (answers.filter(Boolean).join('\n') || '(none)'),
      freeText ? `\nAdditional notes:\n${freeText}` : ''
    ].join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        appendedDescription: { type: 'string' },
        starterTasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              notes: { type: 'string' }
            },
            required: ['title']
          },
          minItems: 0,
          maxItems: 12
        }
      },
      required: ['appendedDescription', 'starterTasks']
    };

    const json = await openAiChat({ system, user, expectJson: true, schema });
    const appended = String(json?.appendedDescription || '').trim();
    const tasks = Array.isArray(json?.starterTasks) ? json.starterTasks : [];

    // Update project description by appending
    const nextDescription = appended ? (desc ? `${desc}\n\n${appended}` : appended) : desc;
    await ProjectsCollection.updateAsync(projectId, { $set: { description: nextDescription, updatedAt: new Date() } });

    // Record suggestions as a note under the project for user review
    try {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      const bullets = (tasks || []).filter(t => t && t.title).map(t => `- ${t.title}${t.notes ? ` — ${t.notes}` : ''}`).join('\n');
      if (bullets) {
        const content = `Task suggestions to kickstart the project:\n\n${bullets}`;
        await NotesCollection.insertAsync({ projectId, title: 'AI tasks suggestions', content, kind: 'aiSummary', createdAt: new Date(), updatedAt: new Date() });
      }
    } catch (err) {
      console.error('[ai.project.applyImprovement] failed to record suggestions note', err);
    }

    return { appendedDescription: appended, tasksCount: Array.isArray(tasks) ? tasks.length : 0 };
  }
});

Meteor.methods({
  async 'app.exportAll'() {
    // Export all collections as arrays
    const projects = await (await import('/imports/api/projects/collections')).ProjectsCollection.find({}).fetchAsync();
    const tasks = await (await import('/imports/api/tasks/collections')).TasksCollection.find({}).fetchAsync();
    const notes = await (await import('/imports/api/notes/collections')).NotesCollection.find({}).fetchAsync();
    const sessions = await (await import('/imports/api/noteSessions/collections')).NoteSessionsCollection.find({}).fetchAsync();
    const lines = await (await import('/imports/api/noteLines/collections')).NoteLinesCollection.find({}).fetchAsync();
    const alarms = await (await import('/imports/api/alarms/collections')).AlarmsCollection.find({}).fetchAsync();
    return { projects, tasks, notes, sessions, lines, alarms, exportedAt: new Date() };
  }
});
