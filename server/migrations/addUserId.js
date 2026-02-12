/**
 * Migration: Add userId to all existing documents.
 *
 * Run this after deploying the multi-user code.
 * It will assign all orphan documents (without userId) to a specified user.
 *
 * Usage from meteor shell:
 *   import { migrateAddUserId } from '/server/migrations/addUserId.js';
 *   await migrateAddUserId('THE_USER_ID');
 *
 * Or call the Meteor method:
 *   Meteor.call('migrations.addUserId', 'THE_USER_ID');
 */

import { Meteor } from 'meteor/meteor';

const COLLECTIONS_TO_MIGRATE = [
  { name: 'projects', path: '/imports/api/projects/collections', key: 'ProjectsCollection' },
  { name: 'tasks', path: '/imports/api/tasks/collections', key: 'TasksCollection' },
  { name: 'notes', path: '/imports/api/notes/collections', key: 'NotesCollection' },
  { name: 'noteSessions', path: '/imports/api/noteSessions/collections', key: 'NoteSessionsCollection' },
  { name: 'noteLines', path: '/imports/api/noteLines/collections', key: 'NoteLinesCollection' },
  { name: 'situations', path: '/imports/api/situations/collections', key: 'SituationsCollection' },
  { name: 'situationActors', path: '/imports/api/situationActors/collections', key: 'SituationActorsCollection' },
  { name: 'situationNotes', path: '/imports/api/situationNotes/collections', key: 'SituationNotesCollection' },
  { name: 'situationQuestions', path: '/imports/api/situationQuestions/collections', key: 'SituationQuestionsCollection' },
  { name: 'situationSummaries', path: '/imports/api/situationSummaries/collections', key: 'SituationSummariesCollection' },
  { name: 'people', path: '/imports/api/people/collections', key: 'PeopleCollection' },
  { name: 'teams', path: '/imports/api/teams/collections', key: 'TeamsCollection' },
  { name: 'budgetLines', path: '/imports/api/budget/collections', key: 'BudgetLinesCollection' },
  { name: 'vendorsCache', path: '/imports/api/budget/collections', key: 'VendorsCacheCollection' },
  { name: 'vendorsIgnore', path: '/imports/api/budget/collections', key: 'VendorsIgnoreCollection' },
  { name: 'calendar', path: '/imports/api/calendar/collections', key: 'CalendarCollection' },
  { name: 'alarms', path: '/imports/api/alarms/collections', key: 'AlarmsCollection' },
  { name: 'files', path: '/imports/api/files/collections', key: 'FilesCollection' },
  { name: 'links', path: '/imports/api/links/collections', key: 'LinksCollection' },
  { name: 'chats', path: '/imports/api/chats/collections', key: 'ChatsCollection' },
  { name: 'appPreferences', path: '/imports/api/appPreferences/collections', key: 'AppPreferencesCollection' },
  { name: 'emails', path: '/imports/api/emails/collections', key: 'EmailsCollection' },
  { name: 'errors', path: '/imports/api/errors/collections', key: 'ErrorsCollection' },
  { name: 'userLogs', path: '/imports/api/userLogs/collections', key: 'UserLogsCollection' },
  { name: 'claudeProjects', path: '/imports/api/claudeProjects/collections', key: 'ClaudeProjectsCollection' },
  { name: 'claudeSessions', path: '/imports/api/claudeSessions/collections', key: 'ClaudeSessionsCollection' },
  { name: 'claudeMessages', path: '/imports/api/claudeMessages/collections', key: 'ClaudeMessagesCollection' },
  { name: 'claudeCommands', path: '/imports/api/claudeCommands/collections', key: 'ClaudeCommandsCollection' },
  { name: 'mcpServers', path: '/imports/api/mcpServers/collections', key: 'McpServersCollection' },
  { name: 'notionIntegrations', path: '/imports/api/notionIntegrations/collections', key: 'NotionIntegrationsCollection' },
  { name: 'notionTickets', path: '/imports/api/notionTickets/collections', key: 'NotionTicketsCollection' },
];

export async function migrateAddUserId(targetUserId) {
  if (!targetUserId) throw new Error('targetUserId is required');

  // Verify user exists
  const user = await Meteor.users.findOneAsync(targetUserId);
  if (!user) throw new Error(`User ${targetUserId} not found`);

  console.log(`[migration] Assigning orphan documents to user ${targetUserId} (${user.emails?.[0]?.address || 'no email'})`);

  let totalUpdated = 0;

  for (const { name, path, key } of COLLECTIONS_TO_MIGRATE) {
    try {
      const mod = await import(path);
      const collection = mod[key];
      if (!collection) {
        console.warn(`[migration] Collection ${key} not found in ${path}, skipping`);
        continue;
      }

      const count = await collection.find({ userId: { $exists: false } }).countAsync();
      if (count === 0) {
        console.log(`[migration] ${name}: 0 orphan docs, skipping`);
        continue;
      }

      const result = await collection.rawCollection().updateMany(
        { userId: { $exists: false } },
        { $set: { userId: targetUserId } }
      );

      const modified = result.modifiedCount || 0;
      totalUpdated += modified;
      console.log(`[migration] ${name}: ${modified} docs updated`);
    } catch (e) {
      console.error(`[migration] ${name}: ERROR`, e.message);
    }
  }

  console.log(`[migration] Done. Total: ${totalUpdated} documents updated.`);
  return { totalUpdated };
}

// Expose as a Meteor method for convenience
Meteor.methods({
  async 'migrations.addUserId'(targetUserId) {
    // Only allow from server console or admin
    if (this.connection) {
      // Called from client — require logged in user and use their own userId
      const userId = Meteor.userId();
      if (!userId) throw new Meteor.Error('not-authorized');
      return migrateAddUserId(userId);
    }
    // Called from server console — use provided userId
    return migrateAddUserId(targetUserId);
  }
});
