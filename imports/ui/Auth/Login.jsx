import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { navigateTo } from '/imports/ui/router.js';

// Module-level: survives component remounts caused by AuthGate re-renders
let lastLoginError = '';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setErrorState] = useState(lastLoginError);
  const [loading, setLoading] = useState(false);

  const setError = (msg) => {
    lastLoginError = msg;
    setErrorState(msg);
  };

  useEffect(() => {
    // Pick up any error from a previous mount
    if (lastLoginError) setErrorState(lastLoginError);
    return () => { /* keep lastLoginError for next mount */ };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const timeout = setTimeout(() => {
      setLoading(false);
      setError('Server not responding. Check your connection.');
    }, 10000);
    Meteor.loginWithPassword(email.trim(), password, (err) => {
      clearTimeout(timeout);
      setLoading(false);
      if (err) {
        console.error('Login error:', err);
        setError(err.reason || err.message || String(err) || 'Login failed');
        return;
      }
      lastLoginError = '';
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
