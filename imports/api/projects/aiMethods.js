import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { openAiChat } from '/imports/api/_shared/aiCore';

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
