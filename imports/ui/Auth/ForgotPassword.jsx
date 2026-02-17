import React, { useState } from 'react';
import { Accounts } from 'meteor/accounts-base';
import { navigateTo } from '/imports/ui/router.js';

export const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    Accounts.forgotPassword({ email: email.trim() }, (err) => {
      setLoading(false);
      if (err) {
        setError(err.reason || err.message || 'Failed to send reset email');
        return;
      }
      setSent(true);
    });
  };

  if (sent) {
    return (
      <div className="authCard">
        <h2>Check your email</h2>
        <p>If an account exists for <strong>{email}</strong>, a reset link has been sent.</p>
        <p className="authMuted">Don't see it? Check your spam or junk folder.</p>
        <div className="authLinks">
          <a href="#/login" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'login' }); }}>
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="authCard">
      <h2>Reset password</h2>
      <p className="authMuted">Enter your email and we'll send a reset link.</p>
      <form onSubmit={handleSubmit}>
        <label className="authLabel">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
        </label>
        {error && <p className="authError">{error}</p>}
        <button type="submit" className="btn btn-primary authSubmit" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      <div className="authLinks">
        <a href="#/login" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'login' }); }}>
          Back to sign in
        </a>
      </div>
    </div>
  );
};
