import React from 'react';
import { createRoot } from 'react-dom/client';
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import '/imports/ui/utils/globalErrors.js';

// Meteor accounts-base clears window.location.hash for reset-password / verify-email
// during package init, then calls registered callbacks inside Meteor.startup().
// Must register synchronously here (before startup fires, before dynamic imports).
Accounts.onResetPasswordLink((token) => {
  window.location.hash = `#/reset-password/${token}`;
});
Accounts.onEmailVerificationLink((token) => {
  window.location.hash = `#/verify-email/${token}`;
});

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
  Promise.all([
    import('/imports/ui/Auth/AuthGate.jsx'),
    import('/imports/ui/App.jsx'),
  ]).then(([{ AuthGate }, { default: App }]) => {
    root.render(
      <AuthGate>
        <App />
      </AuthGate>
    );
  });
});
