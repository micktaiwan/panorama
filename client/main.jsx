import React from 'react';
import { createRoot } from 'react-dom/client';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import '/imports/ui/utils/globalErrors.js';

// Apply cached theme before React renders to prevent flash
const cachedTheme = localStorage.getItem('panorama-theme');
if (cachedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light');
}

// Auth wrapper: shows Login when not logged in, App when logged in
const AuthGate = ({ App, Login }) => {
  const { user, loggingIn } = useTracker(() => ({
    user: Meteor.user(),
    loggingIn: Meteor.loggingIn(),
  }));

  if (loggingIn) return <div className="loginPage"><p style={{ color: 'var(--muted)' }}>Loading...</p></div>;
  if (!user) return <Login />;
  return <App />;
};

Meteor.startup(() => {
  const container = document.getElementById('react-target');
  const root = createRoot(container);

  // Check if this is the standalone chat window
  const isChatWindow = window.location.search.includes('chatWindow=1');

  if (isChatWindow) {
    // Load only the ChatWidget in standalone mode
    import('/imports/ui/components/ChatWidget/ChatWidget.jsx').then(({ default: ChatWidget }) => {
      import('/imports/ui/App.css'); // Global styles
      root.render(
        <div className="ChatWindowApp">
          <ChatWidget isStandalone={true} />
        </div>
      );
    });
    return;
  }

  // Normal app loading
  // Sync local toggle for mobile tasks route (LAN) to server on startup
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem('panorama.mobileTasksEnabled');
    if (raw != null) {
      const enabled = String(raw) === 'true';
      Meteor.call('mobileTasksRoute.setEnabled', enabled, () => {});
    }
  }

  Promise.all([
    import('/imports/ui/App.jsx'),
    import('/imports/ui/Login/Login.jsx'),
  ]).then(([{ default: App }, { Login }]) => {
    root.render(<AuthGate App={App} Login={Login} />);
  });
});
