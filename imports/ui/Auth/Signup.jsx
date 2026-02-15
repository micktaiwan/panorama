import React, { useState } from 'react';
import { Accounts } from 'meteor/accounts-base';
import { navigateTo } from '/imports/ui/router.js';

const MIN_PASSWORD_LENGTH = 8;

export const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    Accounts.createUser({ email: email.trim(), password }, (err) => {
      setLoading(false);
      if (err) {
        setError(err.reason || err.message || 'Signup failed');
        return;
      }
      navigateTo({ name: 'home' });
    });
  };

  return (
    <div className="authCard">
      <h2>Create account</h2>
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
        <label className="authLabel">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <label className="authLabel">
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            required
          />
        </label>
        {error && <p className="authError">{error}</p>}
        <button type="submit" className="btn btn-primary authSubmit" disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <div className="authLinks">
        <a href="#/login" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'login' }); }}>
          Already have an account? Sign in
        </a>
      </div>
    </div>
  );
};
