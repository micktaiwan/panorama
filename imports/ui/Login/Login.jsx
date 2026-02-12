import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import './Login.css';

export const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (isRegister) {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }
      Accounts.createUser({ email, password }, (err) => {
        setLoading(false);
        if (err) setError(err.reason || err.message);
      });
    } else {
      Meteor.loginWithPassword(email, password, (err) => {
        setLoading(false);
        if (err) setError(err.reason || err.message);
      });
    }
  };

  return (
    <div className="loginPage">
      <div className="loginCard">
        <h1 className="loginTitle">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          Panorama
        </h1>
        <form onSubmit={handleSubmit}>
          <label className="loginLabel">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="loginInput"
              placeholder="you@example.com"
            />
          </label>
          <label className="loginLabel">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="loginInput"
              placeholder="••••••••"
            />
          </label>
          {isRegister && (
            <label className="loginLabel">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="loginInput"
                placeholder="••••••••"
              />
            </label>
          )}
          {error && <div className="loginError">{error}</div>}
          <button type="submit" className="btn btn-primary loginBtn" disabled={loading}>
            {loading ? '...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <p className="loginToggle">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}
          {' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(!isRegister); setError(''); }}>
            {isRegister ? 'Sign in' : 'Register'}
          </a>
        </p>
      </div>
    </div>
  );
};
