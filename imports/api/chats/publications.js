import { Meteor } from 'meteor/meteor';
import { ChatsCollection } from './collections';

// Publish recent chat messages
Meteor.publish('chats.recent', function (limit = 100) {
  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
  return ChatsCollection.find({}, { sort: { createdAt: -1 }, limit: lim });
});


