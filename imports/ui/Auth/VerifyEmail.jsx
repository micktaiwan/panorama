import React, { useState, useEffect } from 'react';
import { Accounts } from 'meteor/accounts-base';
import { navigateTo } from '/imports/ui/router.js';

export const VerifyEmail = ({ token }) => {
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    Accounts.verifyEmail(token, (err) => {
      if (err) {
        setStatus('error');
        setError(err.reason || err.message || 'Verification failed');
        return;
      }
      setStatus('success');
      setTimeout(() => navigateTo({ name: 'home' }), 2000);
    });
  }, [token]);

  if (status === 'verifying') {
    return <div className="authCard"><p>Verifying your email...</p></div>;
  }
  if (status === 'error') {
    return (
      <div className="authCard">
        <h2>Verification failed</h2>
        <p className="authError">{error}</p>
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
      <h2>Email verified</h2>
      <p>Redirecting...</p>
    </div>
  );
};
