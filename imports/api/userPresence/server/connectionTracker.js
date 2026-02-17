import { Accounts } from 'meteor/accounts-base';
import { UserPresenceCollection } from '../collections';
import { NotesCollection } from '/imports/api/notes/collections';

// In-memory map: connectionId → userId
// Each Meteor process tracks only its own DDP connections.
// Both instances (Electron + VPS) share the same MongoDB,
// so the connections counter stays accurate across instances.
const connectionMap = new Map();

export const startConnectionTracker = () => {
  Accounts.onLogin(({ user, connection }) => {
    if (!user?._id || !connection?.id) return;

    const userId = user._id;
    connectionMap.set(connection.id, userId);

    const now = new Date();
    UserPresenceCollection.upsertAsync(
      { userId },
      {
        $inc: { connections: 1 },
        $set: { status: 'online', lastSeenAt: now, updatedAt: now },
        $setOnInsert: { userId, createdAt: now },
      }
    );

    connection.onClose(() => {
      const uid = connectionMap.get(connection.id);
      connectionMap.delete(connection.id);
      if (!uid) return;

      UserPresenceCollection.findOneAsync({ userId: uid }).then((doc) => {
        if (!doc) return;
        const newCount = Math.max(0, (doc.connections || 1) - 1);
        const update = {
          $set: {
            connections: newCount,
            updatedAt: new Date(),
          },
        };
        if (newCount <= 0) {
          update.$set.status = 'offline';
          // Release all note locks held by this user (last connection closed)
          NotesCollection.rawCollection().updateMany(
            { lockedBy: uid },
            { $unset: { lockedBy: '', lockedAt: '' } }
          ).catch(e => console.error('[locks] disconnect release failed', e));
        }
        UserPresenceCollection.updateAsync({ userId: uid }, update);
      });
    });
  });
};
