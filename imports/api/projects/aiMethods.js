import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

/**
 * Clean AI response by removing Markdown code blocks (```json...```)
 * and other formatting artifacts that prevent JSON parsing
 */
function cleanJsonResponse(text) {
  let cleaned = String(text || '').trim();
  // Remove ```json...``` or ```...``` code blocks
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

const NOTES_FOR_CONTEXT = 8;
const NOTE_EXCERPT_CHARS = 1200;

/**
 * Most recent notes of a project, as prompt-ready excerpts.
 * What the user already wrote down is the best material to avoid asking
 * questions already answered, and to write a description that matches reality.
 */
async function buildProjectNotesBlock(projectId) {
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const notes = await NotesCollection.find(
    { projectId },
    { sort: { updatedAt: -1, createdAt: -1 }, limit: NOTES_FOR_CONTEXT, fields: { title: 1, content: 1, kind: 1 } }
  ).fetchAsync();

  const usable = (notes || [])
    // AI-generated summaries would make the model paraphrase itself
    .filter(n => n.kind !== 'aiSummary')
    .map(n => {
      const title = String(n.title || '(untitled note)').trim();
      const body = String(n.content || '').trim().slice(0, NOTE_EXCERPT_CHARS);
      return body ? `### ${title}\n${body}` : null;
    })
    .filter(Boolean);

  if (usable.length === 0) return '(no notes yet)';
  return usable.join('\n\n');
}

Meteor.methods({
  async 'ai.project.improvementQuestions'(projectId) {
    check(projectId, String);
    ensureLoggedIn(this.userId);
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const project = await ProjectsCollection.findOneAsync({ _id: projectId, memberIds: this.userId });
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    const name = String(project.name || '').trim();
    const desc = String(project.description || '').trim();

    const userContext = buildUserContextBlock();
    const system = `You are a product discovery assistant. Ask clarifying questions to improve a project description.\n\n${userContext}`;
    const notesBlock = await buildProjectNotesBlock(projectId);
    const user = [
      'Given the project below, ask up to 6 high-signal questions that would help clarify scope, outcomes, constraints, and first steps.',
      'Keep questions concise and concrete. Use the same language as the user content when possible (often French).',
      'Do NOT ask about anything the existing notes already answer: read them first, then ask about what is still missing.',
      'Return STRICT JSON with this exact structure: {"questions": ["question 1", "question 2", ...]}',
      'The questions array should contain 3-6 strings.',
      '',
      `Project name: ${name || '(untitled)'}`,
      `Current description: ${desc || '(empty)'}`,
      '',
      'Existing notes in this project (most recent first):',
      notesBlock
    ].join('\n');

    const schema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: { type: 'string' },
          minItems: 3,
          maxItems: 6,
          description: 'Array of clarifying questions to improve the project description'
        }
      },
      required: ['questions'],
      additionalProperties: false
    };

    const result = await chatComplete({
      system,
      messages: [{ role: 'user', content: user }],
      responseFormat: 'json',
      schema
    });

    console.log('[ai.project.improvementQuestions] Raw result:', result.text?.substring(0, 200));
    const cleaned = cleanJsonResponse(result.text);
    console.log('[ai.project.improvementQuestions] Cleaned result:', cleaned?.substring(0, 200));

    const json = JSON.parse(cleaned);
    const qs = Array.isArray(json?.questions) ? json.questions.filter(q => typeof q === 'string' && q.trim()) : [];
    console.log('[ai.project.improvementQuestions] Parsed questions count:', qs.length);

    return { questions: qs };
  },

  async 'ai.project.applyImprovement'(projectId, payload) {
    check(projectId, String);
    check(payload, Object);
    ensureLoggedIn(this.userId);
    const answers = Array.isArray(payload.answers) ? payload.answers.map(a => String(a || '')) : [];
    const freeText = typeof payload.freeText === 'string' ? payload.freeText : '';

    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const project = await ProjectsCollection.findOneAsync({ _id: projectId, memberIds: this.userId });
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    const name = String(project.name || '').trim();
    const desc = String(project.description || '').trim();

    const userContext = buildUserContextBlock();
    const system = `You improve project descriptions and propose initial actionable tasks.\n\n${userContext}`;
    const rules = [
      'Return STRICT JSON with this exact structure: {"appendedDescription": "text to append", "starterTasks": [{"title": "task", "notes": "optional notes"}, ...]}',
      'Language: respond in the same language as the user inputs and project description (often French).',
      'Improved description should APPEND to the existing description, not replace it. Provide only the appended paragraph(s), not the full description.',
      'Task suggestions must be concrete, short, and feasible as first steps (3–8 items). Do not invent deadlines.'
    ].join(' ');

    const notesBlock = await buildProjectNotesBlock(projectId);
    const user = [
      rules,
      '',
      `Project name: ${name || '(untitled)'}`,
      `Current description: ${desc || '(empty)'}`,
      '',
      'Existing notes in this project (most recent first) — ground the description and the tasks in what is already written here, do not contradict it and do not repeat it verbatim:',
      notesBlock,
      '',
      'User answers to clarifying questions (free text merged):',
      (answers.filter(Boolean).join('\n') || '(none)'),
      freeText ? `\nAdditional notes:\n${freeText}` : ''
    ].join('\n');

    const schema = {
      type: 'object',
      properties: {
        appendedDescription: {
          type: 'string',
          description: 'Text to append to the existing project description'
        },
        starterTasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              notes: { type: 'string', description: 'Optional task notes or context' }
            },
            required: ['title'],
            additionalProperties: false
          },
          minItems: 3,
          maxItems: 8,
          description: 'Array of suggested starter tasks'
        }
      },
      required: ['appendedDescription', 'starterTasks'],
      additionalProperties: false
    };

    const result = await chatComplete({
      system,
      messages: [{ role: 'user', content: user }],
      responseFormat: 'json',
      schema
    });
    const cleaned = cleanJsonResponse(result.text);
    const json = JSON.parse(cleaned);
    const appended = String(json?.appendedDescription || '').trim();
    const tasks = Array.isArray(json?.starterTasks) ? json.starterTasks : [];

    // Update project description by appending
    const nextDescription = appended ? (desc ? `${desc}\n\n${appended}` : appended) : desc;
    await ProjectsCollection.updateAsync(projectId, { $set: { description: nextDescription, updatedAt: new Date() } });

    // Record suggestions as a note under the project for user review
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const bullets = (tasks || []).filter(t => t && t.title).map(t => `- ${t.title}${t.notes ? ` — ${t.notes}` : ''}`).join('\n');
    if (bullets) {
      const content = `Task suggestions to kickstart the project:\n\n${bullets}`;
      await NotesCollection.insertAsync({ projectId, title: 'AI tasks suggestions', content, kind: 'aiSummary', userId: this.userId, createdAt: new Date(), updatedAt: new Date() });
    }

    return { appendedDescription: appended, tasksCount: Array.isArray(tasks) ? tasks.length : 0 };
  }
});
