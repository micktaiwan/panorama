import React from 'react';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { notify } from '../utils/notify.js';

export const PrefsGeneral = ({ pref }) => {
  const [theme, setTheme] = React.useState('dark');
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  const [mobileTasksEnabled, setMobileTasksEnabled] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem('panorama.mobileTasksEnabled');
      return raw == null ? true : String(raw) === 'true';
    } catch {
      return true;
    }
  });
  const [lanIp, setLanIp] = React.useState('');

  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getStatus', (err, res) => {
      if (err) return;
      const sv = !!(res?.enabled);
      setMobileTasksEnabled(sv);
      try { window.localStorage.setItem('panorama.mobileTasksEnabled', String(sv)); } catch {}
    });
  }, []);

  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getLanIps', (err, res) => {
      if (err) { setLanIp(''); return; }
      setLanIp(Array.isArray(res?.ips) && res.ips.length > 0 ? res.ips[0] : '');
    });
  }, []);

  React.useEffect(() => {
    if (!pref) return;
    setTheme(pref.theme || 'dark');
    setFilesDir(pref.filesDir || '');
    setDevUrlMode(!!pref.devUrlMode);
  }, [pref?._id]);

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
                Meteor.call('appPreferences.update', { theme: next }, () => {});
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
          <div className="prefsLabel">Mobile tasks page (LAN)</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={mobileTasksEnabled ? 'enabled' : 'disabled'}
              options={[{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]}
              onSubmit={(next) => {
                const v = next === 'enabled';
                setMobileTasksEnabled(v);
                try { window.localStorage.setItem('panorama.mobileTasksEnabled', String(v)); } catch {}
                Meteor.call('mobileTasksRoute.setEnabled', v, () => {});
                notify({ message: `Mobile tasks page ${v ? 'enabled' : 'disabled'}`, kind: 'success' });
              }}
            />
            {lanIp ? <span className="ml8" style={{ color: 'var(--muted)' }}>{`http://${lanIp}:3000`}</span> : null}
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
