import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';
import { toOneLine, formatAnchors, buildEntriesBlock, buildProjectsBlock } from '/imports/api/_shared/aiCore';

Meteor.methods({
  async 'ai.cleanUserLog'(logId) {
    check(logId, String);

    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
    const entry = await UserLogsCollection.findOneAsync({ _id: logId });
    if (!entry) throw new Meteor.Error('not-found', 'UserLog entry not found');

    const original = typeof entry.content === 'string' ? entry.content : '';
    if (!original.trim()) {
      return { content: original };
    }

    const userContext = buildUserContextBlock();
    const system = `You fix spelling and basic grammar without changing meaning or tone.\n\n${userContext}`;
    const instructions = [
      'This is a short journal entry. Do not summarize or translate.',
      'Keep the same language as the original.',
      'Fix obvious spelling and simple grammar issues. Keep emojis as-is.',
      'Return the corrected text only.'
    ].join(' ');
    const user = `${instructions}\n\nOriginal entry:\n\n\`\`\`\n${original}\n\`\`\``;

    try {
      const result = await chatComplete({ 
        system, 
        messages: [{ role: 'user', content: user }] 
      });
      const cleaned = result.text;

      await UserLogsCollection.updateAsync(logId, { $set: { content: cleaned, updatedAt: new Date() } });
      return { content: cleaned };
    } catch (error) {
      console.error('[ai.cleanUserLog] Error:', error);
      throw new Meteor.Error('ai-clean-failed', `Failed to clean user log: ${error.message}`);
    }
  },

  async 'userLogs.summarizeWindow'(windowKey, hours, options) {
    check(windowKey, String);
    const n = Number(hours);
    let promptOverride = '';
    if (typeof options === 'string') {
      promptOverride = options;
    } else if (options?.promptOverride && typeof options.promptOverride === 'string') {
      promptOverride = options.promptOverride;
    }
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

    const userContext = buildUserContextBlock();
    const system = ([
      'You analyze short journal entries and produce: (1) a structured summary organized by subject in simple text format, (2) task suggestions.',
      'Do NOT invent facts. Use the provided entries only. Keep original language (typically French).',
      'Return STRICT JSON matching the provided schema. No Markdown, no extra text.',
      'Time policy: When mentioning times, format them in 24-hour local time as HH:mm. Only include a calendar date if it is not today, and format it human-readably (e.g., 12 Sep 2025). Never output raw ISO timestamps or timezone offsets in the summary.',
      '',
      'TASK GENERATION RULES:',
      '- Extract actionable items from journal entries that represent concrete tasks to be done.',
      '- Each task MUST include sourceLogIds array with the journal entry IDs that justify this task.',
      '- If no clear actionable items exist, return empty tasks array.',
      '- Task titles should be clear, concise action statements (e.g., "Call client about project status", "Review budget proposal").',
      '- Assign appropriate projectId if the task clearly relates to an existing project, otherwise leave empty.',
      '- Extract deadlines only if explicitly mentioned in the entries, otherwise leave empty.',
      '- Focus on quality over quantity: prefer fewer, well-grounded tasks over many weak suggestions.',
      '',
      userContext
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
      

      const result = await chatComplete({ system: customSystem, messages: [{ role: 'user', content: customUser }] });
      const content = result.text;
      parsed = { summary: String(content || '').trim(), tasks: [] };
    } else {
      // Default behavior: structured JSON with summary and task suggestions
      
      // Define JSON schema for structured output
      const schema = {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Structured summary organized by subject"
          },
          tasks: {
            type: "array",
            description: "Array of task suggestions",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Clear, concise action title"
                },
                notes: {
                  type: "string",
                  description: "Optional additional details"
                },
                projectId: {
                  type: "string",
                  description: "ID of existing project or empty string"
                },
                deadline: {
                  type: "string",
                  description: "ISO date (YYYY-MM-DD) or empty string"
                },
                sourceLogIds: {
                  type: "array",
                  description: "Array of journal entry IDs that ground this task",
                  items: {
                    type: "string"
                  }
                }
              },
              required: ["title", "sourceLogIds"]
            }
          }
        },
        required: ["summary", "tasks"]
      };

      const result = await chatComplete({ 
        system, 
        messages: [{ role: 'user', content: instructions }],
        responseFormat: 'json',
        schema: schema
      });
      
      let json;
      try {
        json = JSON.parse(result.text);
      } catch (parseError) {
        console.error('[userLogs.summarizeWindow] JSON parse error:', parseError, 'Raw text:', result.text);
        // Fallback: try to extract JSON from text if it's wrapped in markdown
        const jsonMatch = result.text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          try {
            json = JSON.parse(jsonMatch[1]);
          } catch {
            throw new Meteor.Error('json-parse-failed', 'Failed to parse JSON response from AI');
          }
        } else {
          throw new Meteor.Error('json-parse-failed', 'Failed to parse JSON response from AI');
        }
      }
      
      parsed = json;
      if (!parsed.tasks) parsed.tasks = [];
      
      // Validate and normalize tasks
      if (Array.isArray(parsed.tasks)) {
        parsed.tasks = parsed.tasks.map(task => ({
          title: String(task.title || '').trim(),
          notes: String(task.notes || '').trim(),
          projectId: String(task.projectId || ''),
          deadline: String(task.deadline || ''),
          sourceLogIds: Array.isArray(task.sourceLogIds) ? task.sourceLogIds.map(String) : []
        })).filter(task => task.title.length > 0); // Remove empty tasks
      } else {
        parsed.tasks = [];
      }
    }

    
    // Ensure window is present; if not, inject our anchors
    if (!parsed.window || typeof parsed.window !== 'object') {
      parsed.window = { tz, sinceIso: sinceLocalIso, nowIso: nowLocalIso, startLocal, endLocal };
    }
    return parsed;
  }
});
