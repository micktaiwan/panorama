import { Meteor } from 'meteor/meteor';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

if (Meteor.isServer) {
  // Global rate limit: 20 method calls per second per connection
  DDPRateLimiter.addRule({
    type: 'method',
    userId: () => true,
  }, 20, 1000);

  // Stricter limit for auth methods: 5 per 10 seconds per connection
  const authMethods = ['login', 'createUser', 'resetPassword', 'forgotPassword'];
  DDPRateLimiter.addRule({
    type: 'method',
    name: (name) => authMethods.includes(name),
  }, 5, 10000);

  // Stricter limit for expensive operations: 3 per 10 seconds per user
  const expensiveMethods = [
    'app.exportAll', 'app.exportArchiveStart',
    'qdrant.indexStart', 'qdrant.indexKindStart',
    'ai.testProvider', 'ai.healthcheck',
  ];
  DDPRateLimiter.addRule({
    type: 'method',
    name: (name) => expensiveMethods.includes(name),
    userId: (userId) => !!userId,
  }, 3, 10000);

  // Subscription rate limit: 30 per second per connection
  DDPRateLimiter.addRule({
    type: 'subscription',
    userId: () => true,
  }, 30, 1000);
}
