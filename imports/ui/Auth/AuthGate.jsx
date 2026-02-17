import React, { useState, useEffect } from 'react';
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { parseHashRoute, navigateTo } from '/imports/ui/router.js';
import { Login } from './Login.jsx';
import { Signup } from './Signup.jsx';
import { ForgotPassword } from './ForgotPassword.jsx';
import { ResetPassword } from './ResetPassword.jsx';
import { VerifyEmail } from './VerifyEmail.jsx';
import './AuthGate.css';

const AUTH_ROUTES = new Set(['login', 'signup', 'forgotPassword', 'resetPassword', 'verifyEmail']);

export const AuthGate = ({ children }) => {
  const [route, setRoute] = useState(parseHashRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const userId = useTracker(() => Meteor.userId());

  // Sync login token to a cookie so HTTP routes (/files/, /download-export/) can authenticate
  useEffect(() => {
    if (userId) {
      const token = Accounts._storedLoginToken();
      if (token) {
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `meteor_login_token=${encodeURIComponent(token)}; path=/; SameSite=Lax${secure}`;
      }
    } else {
      document.cookie = 'meteor_login_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  }, [userId]);

  // If logged in and on an auth route, redirect to home
  if (userId && AUTH_ROUTES.has(route?.name)) {
    navigateTo({ name: 'home' });
    return null;
  }

  // If logged in, render the app
  if (userId) {
    return children;
  }

  // Not logged in: show auth pages
  const authContent = (() => {
    switch (route?.name) {
      case 'signup':
        return <Signup />;
      case 'forgotPassword':
        return <ForgotPassword />;
      case 'resetPassword':
        return <ResetPassword token={route.token} />;
      case 'verifyEmail':
        return <VerifyEmail token={route.token} />;
      default:
        return <Login />;
    }
  })();

  return (
    <div className="authGate">
      <div className="authContainer">
        <div className="authLogo">
          <img src="/favicon.svg" alt="" width="48" height="48" />
          <h1>Panorama</h1>
        </div>
        {authContent}
      </div>
    </div>
  );
};
