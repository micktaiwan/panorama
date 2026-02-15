import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';
import { toOneLine } from '/imports/api/_shared/aiCore';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'ai.textToTasksAnalyze'(inputText) {
    check(inputText, String);
    ensureLoggedIn(this.userId);

    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find({ userId: this.userId }, { fields: { name: 1, description: 1 } }).fetchAsync();

    const catalog = projects
      .filter(p => !!p.name)
      .map(p => ({ name: toOneLine(p.name), description: toOneLine(p.description) }));

    const userContext = buildUserContextBlock();
    const system = `You convert free-form text into structured projects and tasks. Output JSON only.\n\n${userContext}`;
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


    const result = await chatComplete({ 
      system, 
      messages: [{ role: 'user', content: instructions }] 
    });
    const parsed = JSON.parse(result.text);
      if (!parsed.projects) parsed.projects = [];
      if (!parsed.tasks) parsed.tasks = [];

      // Post-process to enforce mapping rules: only new projects in projects[],
      // and convert non-matching suggestions to matchType 'new' with a name.
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
          // Task matches existing project
        } else if (nameLc) {
          if (unmatchedSamples.length < 5) {
            unmatchedSamples.push({ title: t.title, suggested: ps.name });
          }
        }
      }
      return parsed;
  }
});
