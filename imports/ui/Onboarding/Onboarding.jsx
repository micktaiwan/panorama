import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import './Onboarding.css';
import { navigateTo } from '/imports/ui/router.js';

export const Onboarding = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const ready = !sub();
  if (!ready) return <div>Loading…</div>;
  const save = () => {
    Meteor.call('appPreferences.update', { onboardedAt: true }, () => {
      navigateTo({ name: 'home' });
    });
  };
  return (
    <div>
      <h2>Welcome to Panorama</h2>
      <p>You're all set. File storage and search are configured automatically.</p>
      <div className="onbActions">
        <button className="btn btn-primary" onClick={save}>Get started</button>
      </div>
    </div>
  );
};
