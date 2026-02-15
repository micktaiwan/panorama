import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

// --- Password & signup config ---

// Password min length is validated client-side in Signup.jsx (Meteor 3 does not support passwordMinLength in Accounts.config)

Accounts.validateNewUser((user) => {
  if (!user.emails?.[0]?.address) {
    throw new Meteor.Error('no-email', 'Email is required');
  }
  const email = user.emails[0].address;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Meteor.Error('invalid-email', 'Invalid email format');
  }
  return true;
});

// --- Email templates ---

Accounts.emailTemplates.siteName = 'Panorama';
Accounts.emailTemplates.from = 'Panorama <noreply@panorama.mickaelfm.me>';

Accounts.emailTemplates.verifyEmail = {
  subject() {
    return 'Verify your Panorama account';
  },
  text(user, url) {
    const token = url.split('/').pop();
    const verifyUrl = Meteor.absoluteUrl(`#/verify-email/${token}`);
    return [
      'Hello,',
      '',
      'To verify your email, click this link:',
      verifyUrl,
      '',
      'If you did not create this account, ignore this email.',
    ].join('\n');
  },
};

Accounts.emailTemplates.resetPassword = {
  subject() {
    return 'Reset your Panorama password';
  },
  text(user, url) {
    const token = url.split('/').pop();
    const resetUrl = Meteor.absoluteUrl(`#/reset-password/${token}`);
    return [
      'Hello,',
      '',
      'To reset your password, click this link:',
      resetUrl,
      '',
      'If you did not request this, ignore this email.',
    ].join('\n');
  },
};

// --- Rate limiting ---

// createUser: 5 per 10 seconds per connection
DDPRateLimiter.addRule({
  type: 'method',
  name: 'createUser',
  connectionId() { return true; },
}, 5, 10000);

// login: 10 per 10 seconds per connection
DDPRateLimiter.addRule({
  type: 'method',
  name: 'login',
  connectionId() { return true; },
}, 10, 10000);

// forgotPassword: 3 per 60 seconds per connection
DDPRateLimiter.addRule({
  type: 'method',
  name: 'forgotPassword',
  connectionId() { return true; },
}, 3, 60000);
