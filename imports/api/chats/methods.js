import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ChatsCollection } from './collections';

const sanitizeMessage = (m) => ({
  role: (m && m.role === 'assistant') ? 'assistant' : 'user',
  content: String((m && m.content) || '').trim(),
  citations: Array.isArray(m && m.citations) ? (m.citations || []).slice(0, 12) : [],
  createdAt: new Date()
});

Meteor.methods({
  async 'chats.insert'(message) {
    check(message, Object);
    const doc = sanitizeMessage(message);
    return ChatsCollection.insertAsync(doc);
  },
  async 'chats.clear'() {
    await ChatsCollection.removeAsync({});
    // Seed with initial assistant message so the UI starts with a prompt
    await ChatsCollection.insertAsync({
      role: 'assistant',
      content: "Hi 👋 I can answer about your workspace and run actions (e.g., create a task). Ask me anything.",
      citations: [],
      createdAt: new Date()
    });
  }
});
