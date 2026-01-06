import { Meteor } from 'meteor/meteor';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { check } from 'meteor/check';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';

const windowKeyToMs = (key) => {
  const k = String(key || '').toLowerCase();
  if (k === '24h' || k === '24') return 24 * 60 * 60 * 1000;
  if (k === '72h' || k === '72') return 72 * 60 * 60 * 1000;
  if (k === '3w' || k === '3weeks' || k === '21d' || k === '21') return 21 * 24 * 60 * 60 * 1000;
  if (k === '7d' || k === '7days' || k === 'last7days' || k === '7') return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000; // default 24h
};

Meteor.methods({
  async 'reporting.aiSummarizeWindow'(windowKey, projFilters, userPrompt, options) {
    check(windowKey, String);
    if (projFilters && typeof projFilters !== 'object') throw new Meteor.Error('invalid-arg', 'projFilters must be an object');
    if (userPrompt !== undefined && typeof userPrompt !== 'string') throw new Meteor.Error('invalid-arg', 'userPrompt must be a string');
    if (options && typeof options !== 'object') throw new Meteor.Error('invalid-arg', 'options must be an object');
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const { TasksCollection } = await import('/imports/api/tasks/collections');

    const k = String(windowKey || '').toLowerCase();
    let since;
    let until;
    if (k === 'all') {
      since = new Date(0);
      until = new Date();
    } else {
      const windowMs = windowKeyToMs(windowKey);
      since = new Date(Date.now() - windowMs);
      until = new Date();
    }

    const includeIds = new Set(Object.entries(projFilters || {}).filter(([, v]) => v === 1).map(([k]) => k));
    const excludeIds = new Set(Object.entries(projFilters || {}).filter(([, v]) => v === -1).map(([k]) => k));
    const projectSelector = { createdAt: { $gte: since } };
    const taskSelector = { status: 'done', statusChangedAt: { $gte: since } };
    const noteSelector = { createdAt: { $gte: since } };
    if (excludeIds.size > 0 || includeIds.size > 0) {
      const idCond = includeIds.size > 0 ? { $in: Array.from(includeIds) } : { $nin: Array.from(excludeIds) };
      projectSelector._id = idCond;
      taskSelector.projectId = idCond;
      noteSelector.projectId = idCond;
    }

    const [projects, tasksDone, notes] = await Promise.all([
      ProjectsCollection.find(projectSelector, { fields: { name: 1, createdAt: 1 } }).fetchAsync(),
      TasksCollection.find(taskSelector, { fields: { title: 1, projectId: 1, statusChangedAt: 1 } }).fetchAsync(),
      NotesCollection.find(noteSelector, { fields: { title: 1, content: 1, projectId: 1, createdAt: 1 } }).fetchAsync()
    ]);

    const rows = [];
    const push = (type, whenIso, title, projectId) => rows.push({ type, whenIso, title, projectId });
    for (const p of projects) push('project_created', new Date(p.createdAt).toISOString(), p.name || '(untitled project)', p._id);
    for (const t of tasksDone) push('task_done', new Date(t.statusChangedAt).toISOString(), t.title || '(untitled task)', t.projectId || '');
    for (const n of notes) push('note_created', new Date(n.createdAt).toISOString(), n.title || '(note)', n.projectId || '');

    // Fallback: if no rows, return a simple rendering respecting format
    if (rows.length === 0) {
      const lang = (options && typeof options.lang === 'string') ? options.lang.toLowerCase() : 'fr';
      const headerText = lang === 'en' ? `Activity report — ${windowKey}` : `Rapport d'activité — ${windowKey}`;
      const headerMd = `# ${headerText}`;
      if (rows.length === 0) {
        const noActText = lang === 'en' ? 'No activity in the selected window.' : "Aucune activité sur la période sélectionnée.";
        return {
          text: `${headerText}\n\n${noActText}`,
          markdown: `${headerMd}\n\n_${noActText}_`
        };
      }
      const byType = rows.reduce((acc, r) => { (acc[r.type] ||= []).push(r); return acc; }, {});
      const render = (title, arr) => (arr && arr.length > 0)
        ? [`## ${title}`, '', ...arr.map(r => `- [${r.whenIso}] ${r.title}`)].join('\n')
        : '';
      const tProjects = lang === 'en' ? 'Projects created' : 'Projets créés';
      const tTasks = lang === 'en' ? 'Tasks completed' : 'Tâches terminées';
      const tNotes = lang === 'en' ? 'Notes added' : 'Notes ajoutées';
      const sectionsMd = [
        render(tProjects, byType.project_created),
        render(tTasks, byType.task_done),
        render(tNotes, byType.note_created)
      ].filter(Boolean).join('\n\n');
      const sectionsText = sectionsMd
        .replace(/^## /gm, '')
        .replace(/^- /gm, '• ');
      return {
        text: `${headerText}\n\n${sectionsText}`,
        markdown: `${headerMd}\n\n${sectionsMd}`
      };
    }

    const lang = (options && typeof options.lang === 'string') ? options.lang.toLowerCase() : 'fr';
    const wantsMarkdown = ((options && typeof options.format === 'string') ? options.format.toLowerCase() : 'text') === 'markdown';

    const userContext = buildUserContextBlock();
    const defaultSystem = [
      'You are an assistant that writes concise CTO activity reports for executive leadership.',
      'Audience: CEO. Objective: inform leadership with a strategic, factual weekly-style update.',
      'Style: high-level; include details only when they clarify a decision or risk.',
      'You receive structured activity items (projects/tasks/notes) and FULL TEXT excerpts of notes.',
      wantsMarkdown ? 'Do not invent facts; rely only on provided content. Output clean Markdown only.' : 'Do not invent facts; rely only on provided content. Output clean plain text only.',
      '\n\n' + userContext
    ].join(' ');
    const itemsBlock = rows.map(r => `- [${r.whenIso}] (${r.type}) ${r.title}${r.projectId ? ` {projectId:${r.projectId}}` : ''}`).join('\n');
    const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const MAX_NOTE_CHARS = 800;
    const notesBlock = (notes || [])
      .filter(n => typeof n.content === 'string' && n.content.trim())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(n => {
        const title = toOneLine(n.title || '');
        const body = toOneLine(n.content).slice(0, MAX_NOTE_CHARS);
        const iso = new Date(n.createdAt).toISOString();
        return `### ${title || 'Note'} — ${iso}${n.projectId ? ` {projectId:${n.projectId}}` : ''}\n${body}`;
      })
      .join('\n\n');

    const outputConstraints = [
      `Output language: ${lang === 'fr' ? 'French' : 'English'}.`,
      wantsMarkdown ? 'Output format: Markdown.' : 'Output format: plain text.'
    ].join(' ');

    const defaultUser = [
      `Period: ${since.toISOString()} → ${until.toISOString()}`,
      'Activities (chronological, newest first):',
      itemsBlock,
      '',
      'Notes content (latest first; full text excerpts):',
      notesBlock || '(none)',
      '',
      'Write a short report for the CEO. Organize by theme or project as appropriate.',
      wantsMarkdown ? 'Use bullet points and proper Markdown headings.' : 'Use short lines with simple bullets or paragraphs. No Markdown.',
      'Sections:',
      '- Highlights (top 3–6 bullets; major advances, outcomes)',
      '- Projects created',
      '- Tasks completed',
      '- Notes added (if meaningful insights emerged)',
      '- Analysis, Risks, Meeting Topics',
      '',
      'Guidance for the last section:',
      '- Analysis: what materially progressed or was achieved (reference tasks/notes when needed).',
      '- Risks: concrete blockers, uncertainties, or deadlines at risk with brief rationale.',
      '- Meeting Topics: 3–6 crisp bullets for the next leadership meeting (decisions needed, dependencies, follow-ups).',
      '- Prioritize what matters; avoid generic statements. Prefer action-oriented wording.',
      'Keep bullets compact. If a section is empty, omit it. Indicate provenance (task done, note) when helpful.',
      '',
      outputConstraints
    ].join('\n');

    const system = userPrompt && userPrompt.trim() ? userPrompt : defaultSystem;
    const user = userPrompt && userPrompt.trim() ? `${itemsBlock}\n\n${notesBlock}\n\n${outputConstraints}` : defaultUser;

    // Use LLM proxy for AI generation
    const result = await chatComplete({
      system,
      messages: [{ role: 'user', content: user }]
    });
    const raw = result.content || '';
    const markdown = wantsMarkdown ? raw : '';
    const text = wantsMarkdown ? raw.replace(/^#+\s*/gm, '').replace(/^-\s*/gm, '• ') : raw;
    return { text, markdown };
  }
});


