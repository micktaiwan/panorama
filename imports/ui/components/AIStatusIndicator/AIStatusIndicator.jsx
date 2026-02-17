import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import './AIStatusIndicator.css';

export const AIStatusIndicator = () => {
  const _sub1 = useSubscribe('appPreferences');
  const _sub2 = useSubscribe('userPreferences');
  const appPref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const userPref = useFind(() => UserPreferencesCollection.find({}, { limit: 1 }))[0];

  const ai = userPref?.ai || appPref?.ai;
  if (!ai) {
    return null;
  }

  const { mode, local, remote } = ai;

  const statusText = mode === 'local'
    ? `Local (${local?.chatModel || 'Unknown'})`
    : `Remote (${remote?.chatModel || 'Unknown'})`;

  return (
    <span className="ai-status-indicator">
      AI: {statusText}
    </span>
  );
};
