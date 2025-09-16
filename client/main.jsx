import React from 'react';
import { createRoot } from 'react-dom/client';
import { Meteor } from 'meteor/meteor';
import App from '/imports/ui/App.jsx';
import '/imports/ui/utils/globalErrors.js';

Meteor.startup(() => {
  // Sync local toggle for mobile tasks route (LAN) to server on startup
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem('panorama.mobileTasksEnabled');
    if (raw != null) {
      const enabled = String(raw) === 'true';
      Meteor.call('mobileTasksRoute.setEnabled', enabled, () => {});
    }
  }
  const container = document.getElementById('react-target');
  const root = createRoot(container);
  root.render(<App />);
});
