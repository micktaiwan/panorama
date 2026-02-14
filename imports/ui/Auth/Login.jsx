import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { navigateTo } from '/imports/ui/router.js';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    Meteor.loginWithPassword(email.trim(), password, (err) => {
      setLoading(false);
      if (err) {
        setError(err.reason || err.message || 'Login failed');
        return;
      }
      navigateTo({ name: 'home' });
    });
  };

  return (
    <div className="authCard">
      <h2>Sign in</h2>
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
            placeholder="Password"
            required
          />
        </label>
        {error && <p className="authError">{error}</p>}
        <button type="submit" className="btn btn-primary authSubmit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <div className="authLinks">
        <a href="#/forgot-password" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'forgotPassword' }); }}>
          Forgot password?
        </a>
        <a href="#/signup" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'signup' }); }}>
          Create an account
        </a>
      </div>
    </div>
  );
};
