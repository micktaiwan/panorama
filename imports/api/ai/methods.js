import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey } from '/imports/api/_shared/config';
import { check } from 'meteor/check';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';

// Normalize multi-line text to a single line
const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const buildPrompt = ({ project, lines }) => {
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
  const numbered = lines.map((l, idx) => `L${idx + 1}: ${l.content}`);
  const body = `\nNotes (numbered):\n${numbered.join('\n')}`;
  return `${head}${context}${body}`;
};

const buildCoachPrompt = ({ project, lines }) => {
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
      // Debug: log final prompt messages
      console.log('[ai.textToTasksAnalyze] System message:', system);
      console.log('[ai.textToTasksAnalyze] User instructions:', instructions);
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
      console.log('[ai.textToTasksAnalyze] Raw model content:', content);
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        console.error('[ai.textToTasksAnalyze] Invalid JSON content from model', { content });
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
      } catch (e) {
        console.error('[ai.textToTasksAnalyze] Post-process mapping error', { error: e && e.message });
      }
      try {
        const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        const projectsArr = Array.isArray(parsed.projects) ? parsed.projects : [];
        const sampleTasks = tasksArr.slice(0, 5).map(t => ({
          title: t && t.title,
          deadline: t && (t.deadline || t.dueDate),
          projectSuggestion: t && t.projectSuggestion
        }));

        // Count suggestion types and matching to existing project names
        const existingNames = new Set((catalog || []).map(p => String(p.name || '').trim().toLowerCase()));
        const suggestionCounts = { existing: 0, new: 0, unknown: 0, missing: 0 };
        let matchedExistingCount = 0;
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
          if (nameLc && existingNames.has(nameLc)) matchedExistingCount += 1;
          else if (nameLc) {
            if (unmatchedSamples.length < 5) unmatchedSamples.push({ title: t.title, suggested: ps.name });
          }
        }

        console.log('[ai.textToTasksAnalyze] Parsed summary:', {
          projectsCount: projectsArr.length,
          tasksCount: tasksArr.length,
          suggestionCounts,
          matchedExistingCount
        });
        console.log('[ai.textToTasksAnalyze] Sample tasks:', JSON.stringify(sampleTasks, null, 2));
        if (unmatchedSamples.length > 0) {
          console.log('[ai.textToTasksAnalyze] Unmatched suggestion samples:', JSON.stringify(unmatchedSamples, null, 2));
        }
      } catch (e) {
        console.error('[ai.textToTasksAnalyze] Error processing parsed content', { error: e && e.message });
      }
      return parsed;
    } catch (e) {
      if (!(e instanceof Meteor.Error)) {
        console.error('[ai.textToTasksAnalyze] Unexpected error', e);
        throw new Meteor.Error('ai-text2tasks-failed', e.message || String(e));
      }
      throw e;
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
    console.log('[ai.summarizeSession] System:', system);
    console.log('[ai.summarizeSession] User:', userContent);

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
    console.log('[ai.summarizeSession] Raw model content:', content);
    const json = JSON.parse(content);
    console.log('[ai.summarizeSession] Parsed keys:', Object.keys(json || {}));

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
    const renderPrev = (arr) => (arr && arr.length > 0)
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
    console.log('[ai.coachQuestions] System:', systemContent);
    console.log('[ai.coachQuestions] User:', userContent);

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
    } catch (e) {
      console.error('[ai.coachQuestions] Invalid JSON content from model', { content });
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
      // Nothing to clean; no-op
      return { content: original };
    }

    const { default: fetch } = await import('node-fetch');

    const system = 'You clean and normalize note text without summarizing or translating.';
    const instructions = [
      'This is a note. Remove emojis. Remove formatting, but keep a text format with titles if needed.',
      'Keep conversation flow and names if it is a conversation.',
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
    } catch (e) {
      console.error('[ai.cleanNote] post-update side effects failed', e);
    }

    return { content: cleaned };
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
