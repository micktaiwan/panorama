import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { NoteSessionsCollection } from './collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

// Normalize short text fields
const sanitizeSessionDoc = (input) => {
  const out = { ...input };
  if (typeof out.name === 'string') out.name = out.name.trim();
  return out;
};

Meteor.methods({
  async 'noteSessions.insert'(doc) {
    check(doc, Object);
    ensureLoggedIn(this.userId);
    if (doc.projectId !== undefined) {
      check(doc.projectId, Match.Maybe(String));
    }
    const sanitized = sanitizeSessionDoc(doc);
    const _id = await NoteSessionsCollection.insertAsync({ ...sanitized, userId: this.userId, createdAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'session', id: _id, text: `${sanitized.name || ''} ${sanitized.aiSummary || ''}`.trim(), projectId: sanitized.projectId || null });
    } catch (e) { console.error('[search][noteSessions.insert] upsert failed', e); }
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    return _id;
  },
  async 'noteSessions.remove'(sessionId) {
    check(sessionId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(NoteSessionsCollection, sessionId, this.userId);
    await NoteLinesCollection.removeAsync({ sessionId, userId: this.userId });
    const ses = await NoteSessionsCollection.findOneAsync({ _id: sessionId });
    const res = await NoteSessionsCollection.removeAsync({ _id: sessionId });
    try { const { deleteBySessionId, deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteBySessionId(sessionId); await deleteDoc('session', sessionId); } catch (e) { console.error('[search][noteSessions.remove] delete failed', e); }
    if (ses && ses.projectId) {
      await ProjectsCollection.updateAsync(ses.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'noteSessions.update'(sessionId, modifier) {
    check(sessionId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    await ensureOwner(NoteSessionsCollection, sessionId, this.userId);
    const ses = await NoteSessionsCollection.findOneAsync({ _id: sessionId });
    const sanitized = sanitizeSessionDoc(modifier);
    const res = await NoteSessionsCollection.updateAsync(sessionId, { $set: { ...sanitized, updatedAt: new Date() } });
    try {
      const next = await NoteSessionsCollection.findOneAsync(sessionId, { fields: { name: 1, aiSummary: 1, projectId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'session', id: sessionId, text: `${next?.name || ''} ${next?.aiSummary || ''}`.trim(), projectId: next?.projectId || null });
    } catch (e) { console.error('[search][noteSessions.update] upsert failed', e); }
    if (ses && ses.projectId) {
      await ProjectsCollection.updateAsync(ses.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'noteSessions.clearCoach'(sessionId) {
    check(sessionId, String);
    ensureLoggedIn(this.userId);
    const ses = await ensureOwner(NoteSessionsCollection, sessionId, this.userId);
    const res = await NoteSessionsCollection.updateAsync(sessionId, {
      $unset: {
        coachQuestions: 1,
        coachQuestionsJson: 1,
        coachIdeasJson: 1,
        coachAnswersJson: 1,
        coachAt: 1,
        coachPrompt: 1
      },
      $set: { updatedAt: new Date() }
    });
    if (ses && ses.projectId) {
      await ProjectsCollection.updateAsync(ses.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'noteSessions.resetAll'(sessionId) {
    check(sessionId, String);
    ensureLoggedIn(this.userId);
    const ses = await ensureOwner(NoteSessionsCollection, sessionId, this.userId);
    // Remove all note lines for this session (scoped to userId)
    await NoteLinesCollection.removeAsync({ sessionId, userId: this.userId });
    // Clear AI summary and coach data on the session
    const res = await NoteSessionsCollection.updateAsync(sessionId, {
      $unset: {
        aiSummary: 1,
        aiSummaryJson: 1,
        aiSummaryAt: 1,
        aiPrompt: 1,
        coachQuestions: 1,
        coachQuestionsJson: 1,
        coachIdeasJson: 1,
        coachAnswersJson: 1,
        coachAt: 1,
        coachPrompt: 1
      },
      $set: { updatedAt: new Date() }
    });
    if (ses && ses.projectId) {
      await ProjectsCollection.updateAsync(ses.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  }
});


