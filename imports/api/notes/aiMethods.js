import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';

// Helper function to update note index and project timestamp
const updateNoteIndex = async (noteId) => {
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const next = await NotesCollection.findOneAsync(noteId, { fields: { title: 1, content: 1, projectId: 1 } });
  const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
  await upsertDoc({ 
    kind: 'note', 
    id: noteId, 
    text: `${next?.title || ''} ${next?.content || ''}`.trim(), 
    projectId: next?.projectId || null 
  });
  if (next?.projectId) {
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    await ProjectsCollection.updateAsync(next.projectId, { $set: { updatedAt: new Date() } });
  }
};

Meteor.methods({
  async 'ai.cleanNote'(noteId, customPrompt = null) {
    check(noteId, String);
    check(customPrompt, Match.Maybe(String));

    const { NotesCollection } = await import('/imports/api/notes/collections');
    const note = await NotesCollection.findOneAsync({ _id: noteId });
    if (!note) throw new Meteor.Error('not-found', 'Note not found');

    const original = typeof note.content === 'string' ? note.content : '';
    if (!original.trim()) {
      return { content: original };
    }

    const userContext = buildUserContextBlock();
    const system = `You are a text cleaner. Your job is to normalize notes without summarizing or translating.\n\n${userContext}`;
    
    // Use custom prompt if provided, otherwise use default instructions
    const instructions = customPrompt || `
    Rules for cleaning notes:
    1. Remove all emojis.
    2. Remove all markdown symbols (e.g. **, #, >, *) but keep the hierarchy: convert titles and subtitles to plain text lines.
    3. Remove timestamps (e.g. "2 minutes ago", "9:14").
    4. For email signatures: remove long blocks. Keep only the sender's name and date. Ignore job titles, phone numbers, or disclaimers.
    5. Keep the conversation flow and speaker names if it's a dialogue.
    6. Keep all original content, do NOT summarize, shorten, or translate.
    7. Preserve the original language of the text.
    8. Correct obvious spelling mistakes.
    Output: plain text only, no markdown, no special formatting, no added text compared to the original
    `;
    
    const user = `${instructions}\n\nOriginal note:\n\n\u0060\u0060\u0060\n${original}\n\u0060\u0060\u0060`;

    try {
      const result = await chatComplete({ 
        system, 
        messages: [{ role: 'user', content: user }] 
      });
      const cleaned = result.text;

      // Persist cleaned content
      await NotesCollection.updateAsync(noteId, { $set: { content: cleaned, updatedAt: new Date() } });

      // Update search vector and project updatedAt
      await updateNoteIndex(noteId);

      return { content: cleaned };
    } catch (error) {
      console.error('[ai.cleanNote] Error:', error);
      throw new Meteor.Error('ai-clean-failed', `Failed to clean note: ${error.message}`);
    }
  },

  async 'ai.summarizeNote'(noteId) {
    check(noteId, String);

    const { NotesCollection } = await import('/imports/api/notes/collections');
    const note = await NotesCollection.findOneAsync({ _id: noteId });
    if (!note) throw new Meteor.Error('not-found', 'Note not found');

    const original = typeof note.content === 'string' ? note.content : '';
    if (!original.trim()) {
      return { content: original };
    }

    const userContext = buildUserContextBlock();
    const system = `You are a text summarizer. Your job is to create concise summaries while preserving key information.\n\n${userContext}`;
    const instructions = `
    Rules for summarizing notes:
    1. Create a concise summary that captures the main points and key information.
    2. Preserve important details, decisions, and action items.
    3. Maintain the original language of the text.
    4. Keep the structure logical and easy to read.
    5. Remove redundant information but keep essential context.
    6. If the note contains lists or bullet points, preserve the most important ones.
    7. For meeting notes, preserve key decisions and next steps.
    8. Output: plain text summary, no markdown formatting.
    `;
    const user = `${instructions}\n\nOriginal note:\n\n\u0060\u0060\u0060\n${original}\n\u0060\u0060\u0060`;

    try {
      const result = await chatComplete({ 
        system, 
        messages: [{ role: 'user', content: user }] 
      });
      const summarized = result.text;

      // Persist summarized content
      await NotesCollection.updateAsync(noteId, { $set: { content: summarized, updatedAt: new Date() } });

      // Update search vector and project updatedAt
      await updateNoteIndex(noteId);

      return { content: summarized };
    } catch (error) {
      console.error('[ai.summarizeNote] Error:', error);
      throw new Meteor.Error('ai-summarize-failed', `Failed to summarize note: ${error.message}`);
    }
  }
});
