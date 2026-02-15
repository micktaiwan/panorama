import React from 'react';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { notify } from '../utils/notify.js';

export const PrefsGeneral = ({ pref, userPref }) => {
  const [theme, setTheme] = React.useState('dark');
  const [filesDir, setFilesDir] = React.useState('');
  const [qdrantUrl, setQdrantUrl] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);

  React.useEffect(() => {
    if (!pref) return;
    setFilesDir(pref.filesDir || '');
    setQdrantUrl(pref.qdrantUrl || '');
    setDevUrlMode(!!pref.devUrlMode);
  }, [pref?._id]);

  React.useEffect(() => {
    if (!userPref) return;
    setTheme(userPref.theme || 'dark');
  }, [userPref?._id, userPref?.theme]);

  return (
    <>
      <h3>General</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Theme</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={theme}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
              onSubmit={(next) => {
                setTheme(next);
                Meteor.call('userPreferences.update', { theme: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Files directory</div>
          <div className="prefsValue">
            <InlineEditable
              value={filesDir}
              placeholder="/path/to/filesDir"
              fullWidth
              onSubmit={(next) => {
                setFilesDir(next);
                Meteor.call('appPreferences.update', { filesDir: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Qdrant URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={qdrantUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setQdrantUrl(next);
                Meteor.call('appPreferences.update', { qdrantUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Use Dev URL instead of bundled server</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={devUrlMode ? 'yes' : 'no'}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
              onSubmit={(next) => {
                const v = next === 'yes';
                setDevUrlMode(v);
                Meteor.call('appPreferences.update', { devUrlMode: v }, () => {});
              }}
            />
          </div>
        </div>
      </div>

      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Display</div>
          <div className="prefsValue">
            <button
              className="btn"
              onClick={() => {
                if (window.electron?.resetZoom) {
                  window.electron.resetZoom();
                  notify({ message: 'Zoom reset to 100%', kind: 'success' });
                } else {
                  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '');
                  const msg = isElectron
                    ? 'Zoom reset not available yet. Please restart the app to enable it.'
                    : 'Zoom reset not available in browser';
                  notify({ message: msg, kind: 'error' });
                }
              }}
            >
              Reset zoom (100%)
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
