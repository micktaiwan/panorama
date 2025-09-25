import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { getOpenAiApiKey } from '/imports/api/_shared/config';
import { openAiChat, toOneLine, formatAnchors, buildEntriesBlock, buildProjectsBlock } from '/imports/api/_shared/aiCore';

Meteor.methods({
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
