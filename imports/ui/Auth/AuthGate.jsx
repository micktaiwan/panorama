import React, { useState, useEffect } from 'react';
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

  const { userId, loggingIn } = useTracker(() => ({
    userId: Meteor.userId(),
    loggingIn: Meteor.loggingIn(),
  }));

  // If logged in and on an auth route, redirect to home
  if (userId && AUTH_ROUTES.has(route?.name)) {
    navigateTo({ name: 'home' });
    return null;
  }

  // If logged in, render the app
  if (userId) {
    return children;
  }

  // If logging in (DDP reconnecting, auto-login from stored token), show loading
  if (loggingIn) {
    return (
      <div className="authGate">
        <div className="authLoading">Loading...</div>
      </div>
    );
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
