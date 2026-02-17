import React from 'react';
import { notify } from '../utils/notify.js';

export const PrefsGeneral = () => {
  return (
    <>
      <h2>General</h2>
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
