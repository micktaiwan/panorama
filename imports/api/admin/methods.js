import { Meteor } from 'meteor/meteor';
import { ensureAdmin } from '/imports/api/_shared/auth';

import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { FilesCollection } from '/imports/api/files/collections';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { TeamsCollection } from '/imports/api/teams/collections';
import { PeopleCollection } from '/imports/api/people/collections';
import { SituationsCollection } from '/imports/api/situations/collections';
import { SituationActorsCollection } from '/imports/api/situationActors/collections';
import { SituationNotesCollection } from '/imports/api/situationNotes/collections';
import { SituationQuestionsCollection } from '/imports/api/situationQuestions/collections';
import { SituationSummariesCollection } from '/imports/api/situationSummaries/collections';
import { BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection } from '/imports/api/budget/collections';
import { ChatsCollection } from '/imports/api/chats/collections';
import { ErrorsCollection } from '/imports/api/errors/collections';
import { UserLogsCollection } from '/imports/api/userLogs/collections';
import { CalendarEventsCollection } from '/imports/api/calendar/collections';
import { GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection } from '/imports/api/emails/collections';
import { MCPServersCollection } from '/imports/api/mcpServers/collections';
import { NotionIntegrationsCollection } from '/imports/api/notionIntegrations/collections';
import { NotionTicketsCollection } from '/imports/api/notionTickets/collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { ClaudeProjectsCollection } from '/imports/api/claudeProjects/collections';
import { ClaudeCommandsCollection } from '/imports/api/claudeCommands/collections';

// All collections with userId field, used for deletion cleanup
const USER_COLLECTIONS = [
  ProjectsCollection, TasksCollection, NotesCollection, NoteSessionsCollection,
  NoteLinesCollection, LinksCollection, FilesCollection, UserPreferencesCollection,
  AlarmsCollection, TeamsCollection, PeopleCollection,
  SituationsCollection, SituationActorsCollection, SituationNotesCollection,
  SituationQuestionsCollection, SituationSummariesCollection,
  BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection,
  ChatsCollection, ErrorsCollection, UserLogsCollection, CalendarEventsCollection,
  GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection,
  MCPServersCollection, NotionIntegrationsCollection, NotionTicketsCollection,
  ClaudeSessionsCollection, ClaudeMessagesCollection, ClaudeProjectsCollection,
  ClaudeCommandsCollection,
];

Meteor.methods({
  async 'admin.getUsers'() {
    await ensureAdmin(this.userId);

    const users = await Meteor.users.find({}, {
      fields: { emails: 1, createdAt: 1, lastLoginAt: 1, isAdmin: 1 },
      sort: { createdAt: 1 },
    }).fetchAsync();

    const enriched = await Promise.all(users.map(async (u) => {
      const uid = u._id;
      const [projects, tasks, notes, files] = await Promise.all([
        ProjectsCollection.find({ userId: uid }).countAsync(),
        TasksCollection.find({ userId: uid }).countAsync(),
        NotesCollection.find({ userId: uid }).countAsync(),
        FilesCollection.find({ userId: uid }).countAsync(),
      ]);
      return {
        _id: uid,
        email: u.emails?.[0]?.address || '(no email)',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        isAdmin: !!u.isAdmin,
        counts: { projects, tasks, notes, files },
      };
    }));

    return enriched;
  },

  async 'admin.setAdmin'(targetUserId, isAdmin) {
    await ensureAdmin(this.userId);

    if (typeof targetUserId !== 'string' || typeof isAdmin !== 'boolean') {
      throw new Meteor.Error('bad-request', 'Invalid parameters');
    }

    // Cannot revoke own admin
    if (targetUserId === this.userId && !isAdmin) {
      throw new Meteor.Error('bad-request', 'Cannot revoke your own admin status');
    }

    // Protect last admin
    if (!isAdmin) {
      const adminCount = await Meteor.users.find({ isAdmin: true }).countAsync();
      if (adminCount <= 1) {
        throw new Meteor.Error('bad-request', 'Cannot revoke the last admin');
      }
    }

    await Meteor.users.updateAsync(targetUserId, { $set: { isAdmin } });
  },

  async 'admin.deleteUser'(targetUserId) {
    await ensureAdmin(this.userId);

    if (typeof targetUserId !== 'string') {
      throw new Meteor.Error('bad-request', 'Invalid parameters');
    }

    // Cannot delete self
    if (targetUserId === this.userId) {
      throw new Meteor.Error('bad-request', 'Cannot delete your own account');
    }

    // Delete all user data from every collection
    let totalDeleted = 0;
    for (const col of USER_COLLECTIONS) {
      const result = await col.rawCollection().deleteMany({ userId: targetUserId });
      totalDeleted += result.deletedCount || 0;
    }

    // Delete the user account itself
    await Meteor.users.removeAsync(targetUserId);

    return { deletedDocuments: totalDeleted };
  },

  async 'admin.getStats'() {
    await ensureAdmin(this.userId);

    const [users, projects, tasks, notes, files] = await Promise.all([
      Meteor.users.find().countAsync(),
      ProjectsCollection.find().countAsync(),
      TasksCollection.find().countAsync(),
      NotesCollection.find().countAsync(),
      FilesCollection.find().countAsync(),
    ]);

    // Qdrant health
    let qdrant = { available: false };
    try {
      const { getQdrantClient, COLLECTION } = await import('/imports/api/search/vectorStore');
      const client = await getQdrantClient();
      const collectionName = COLLECTION();
      const info = await client.getCollection(collectionName);
      qdrant = {
        available: true,
        collection: collectionName,
        pointsCount: info.points_count,
        vectorsCount: info.vectors_count,
        status: info.status,
      };
    } catch (e) {
      qdrant = { available: false, error: e?.message || 'Unknown error' };
    }

    // Disk usage for files directory
    let disk = null;
    try {
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
      const prefs = await AppPreferencesCollection.findOneAsync({});
      const dir = prefs?.filesDir;
      if (dir) {
        const fs = await import('fs');
        const path = await import('path');
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          let totalSize = 0;
          for (const entry of entries) {
            try {
              const stat = fs.statSync(path.join(dir, entry));
              if (stat.isFile()) totalSize += stat.size;
            } catch (_err) { /* skip */ }
          }
          disk = { dir, fileCount: entries.length, totalBytes: totalSize };
        }
      }
    } catch (_err) { /* disk info not critical */ }

    return { users, projects, tasks, notes, files, qdrant, disk };
  },
});
