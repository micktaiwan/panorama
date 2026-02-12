import { Meteor } from 'meteor/meteor';
import { ChatsCollection } from './collections';

// Publish recent chat messages
Meteor.publish('chats.recent', function (limit = 100) {
  if (!this.userId) return this.ready();
  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
  return ChatsCollection.find({ userId: this.userId }, { sort: { createdAt: -1 }, limit: lim });
});


