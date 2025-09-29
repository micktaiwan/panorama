import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import './AIStatusIndicator.css';

export const AIStatusIndicator = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  
  if (!pref?.ai) {
    return null;
  }

  const { mode, local, remote } = pref.ai;
  const isLocal = mode === 'local' || (mode === 'auto' && pref.ai.fallback === 'local');
  const isRemote = mode === 'remote' || (mode === 'auto' && pref.ai.fallback === 'remote');
  
  let statusText = '';
  
  if (isLocal) {
    statusText = `Local (${local?.chatModel || 'Unknown'})`;
  } else if (isRemote) {
    statusText = `Remote (${remote?.chatModel || 'Unknown'})`;
  } else {
    statusText = `Auto (${local?.chatModel || 'Unknown'})`;
  }

  return (
    <span className="ai-status-indicator">
      AI: {statusText}
    </span>
  );
};
