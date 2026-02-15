import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { toOneLine } from '/imports/api/_shared/aiCore';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

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
  async 'ai.summarizeSession'(sessionId) {
    check(sessionId, String);
    ensureLoggedIn(this.userId);

    const session = await NoteSessionsCollection.findOneAsync({ _id: sessionId, userId: this.userId });
    if (!session) {
      throw new Meteor.Error('not-found', 'Session not found');
    }

    const lines = await NoteLinesCollection.find({ sessionId, userId: this.userId }).fetchAsync();
    if (!lines || lines.length === 0) {
      throw new Meteor.Error('no-lines', 'Cannot summarize an empty session. Add some note lines first.');
    }
    const project = session.projectId ? await import('/imports/api/projects/collections').then(m => m.ProjectsCollection.findOneAsync({ _id: session.projectId })) : null;

    const prompt = buildPrompt({ project, lines });


    // Lazy import to avoid client bundling
    // Structured JSON output with citations
    const numbered = lines.map((l, idx) => `L${idx + 1}: ${l.content}`);
    const userContext = buildUserContextBlock();
    const system = 'You summarize CTO project meeting notes strictly from provided content.\n\n' + userContext;
    const instructions = [
      'Use ONLY the provided notes. Do not invent facts.',
      'Return a JSON object with fields: summary, decisions, risks, nextSteps.',
      'summary is a concise paragraph (3-6 sentences) capturing the essence of the discussion.',
      'Each of decisions/risks/nextSteps is an array of items: { text: string, cites: number[] } where cites are line numbers like 1,2,3 referring to L1..Ln.',
      'If a section has no content, return an empty array for that section (summary must not be empty).'
    ].join(' ');


    // Log final prompt messages for visibility
    const userContent = `${instructions}\n\nNotes (numbered):\n${numbered.join('\n')}`;

    const result = await chatComplete({ 
      system, 
      messages: [{ role: 'user', content: userContent }] 
    });
    const json = JSON.parse(result.text);

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
    ensureLoggedIn(this.userId);

    const session = await NoteSessionsCollection.findOneAsync({ _id: sessionId, userId: this.userId });
    if (!session) throw new Meteor.Error('not-found', 'Session not found');

    const lines = await NoteLinesCollection.find({ sessionId, userId: this.userId }).fetchAsync();
    const project = session.projectId ? await import('/imports/api/projects/collections').then(m => m.ProjectsCollection.findOneAsync({ _id: session.projectId })) : null;

    const prompt = buildCoachPrompt({ project, lines });


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

    // Build final system and user contents once and log them
    const userContext = buildUserContextBlock();
    const systemContent = 'You are a CTO project coach. Ask concise, high-signal questions, propose concrete ' +
      'ideas/suggestions, and if the notes contain explicit questions, provide concise answers. Ground ' +
      'everything strictly in the provided notes. Only propose NEW items; do not repeat or rephrase ' +
      'previously asked or suggested ones. Keep same language as the original notes (generally French).\n\n' +
      userContext;
    const userContent = `${prompt}\n\nPrevious coach items (for context; avoid duplicates):\nQuestions:\n` +
      `${previousQuestionsBlock}\n\nIdeas:\n${previousIdeasBlock}\n\nAnswers:\n${previousAnswersBlock}\n\n` +
      `Notes (numbered):\n${numbered.join('\n')}`;

    const result = await chatComplete({ 
      system: systemContent, 
      messages: [{ role: 'user', content: userContent }] 
    });
    const parsed = JSON.parse(result.text);
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
  }
});
