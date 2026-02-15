import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ChatsCollection } from './collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const sanitizeMessage = (m) => ({
  role: (m && m.role === 'assistant') ? 'assistant' : 'user',
  content: String((m && m.content) || '').trim(),
  citations: Array.isArray(m && m.citations) ? (m.citations || []).slice(0, 12) : [],
  createdAt: new Date()
});

Meteor.methods({
  async 'chats.insert'(message) {
    check(message, Object);
    ensureLoggedIn(this.userId);
    const doc = { ...sanitizeMessage(message), userId: this.userId };
    return ChatsCollection.insertAsync(doc);
  },
  async 'chats.clear'() {
    ensureLoggedIn(this.userId);
    await ChatsCollection.removeAsync({ userId: this.userId });
    // Seed with initial assistant message so the UI starts with a prompt
    await ChatsCollection.insertAsync({
      role: 'assistant',
      content: "Hi 👋 I can answer about your workspace and run actions (e.g., create a task). Ask me anything.",
      citations: [],
      userId: this.userId,
      createdAt: new Date()
    });
  }
});
