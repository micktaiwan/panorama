import { Meteor } from 'meteor/meteor';

/**
 * Log security-relevant actions (login, delete, export, etc.)
 * Writes to the UserLogsCollection if available, otherwise console.
 */
export async function auditLog(action, details = {}) {
  const userId = details.userId || Meteor.userId?.() || null;
  const entry = {
    action,
    userId,
    timestamp: new Date(),
    ...details,
  };

  // Always log to console for ops visibility
  console.log(`[audit] ${action}`, JSON.stringify({ userId, ...details }));

  // Persist to UserLogsCollection if available
  if (Meteor.isServer) {
    try {
      const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
      await UserLogsCollection.insertAsync({
        userId,
        type: 'audit',
        action,
        details,
        createdAt: new Date(),
      });
    } catch (e) {
      // Don't let audit failures break the app
      console.error('[audit] Failed to persist log:', e.message);
    }
  }
}
