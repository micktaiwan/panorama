import React from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '../utils/notify.js';
import { playBeep } from '../utils/sound.js';

export const PrefsDebug = () => {
  const [tokenStats, setTokenStats] = React.useState(null);
  const [countingTokens, setCountingTokens] = React.useState(false);

  const countTokens = React.useCallback(() => {
    setCountingTokens(true);
    setTokenStats(null);
    Meteor.call('panorama.countAllTokens', (err, result) => {
      setCountingTokens(false);
      if (err) {
        notify({ message: `Failed to count tokens: ${err.reason || err.message}`, kind: 'error' });
      } else {
        setTokenStats(result);
        notify({ message: `Token count completed: ${result.globalStats.totalTokens} tokens across ${result.globalStats.totalItems} items`, kind: 'success' });
      }
    });
  }, []);

  return (
    <>
      <h3>Debug</h3>
      <div className="muted" style={{ fontSize: '13px', marginBottom: '12px' }}>
        Admin only — this section is not visible to regular users.
      </div>

      <h4>Test notify</h4>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Notifications</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              playBeep(0.5);
              notify({ message: 'Test beep played', kind: 'success' });
            }}>Test audio</button>
            <button className="btn ml8" onClick={() => {
              setTimeout(() => {
                playBeep(0.5);
                notify({ message: 'Delayed test: beep + notify', kind: 'success' });
              }, 3000);
            }}>Test delayed audio (3s)</button>
            <button className="btn ml8" onClick={() => {
              const tests = [
                { message: 'Info notify test', kind: 'info' },
                { message: 'Success notify test', kind: 'success' },
                { message: 'Error notify test', kind: 'error' }
              ];
              tests.forEach((t, i) => setTimeout(() => notify(t), i * 1200));
            }}>Test all notify</button>
          </div>
        </div>
      </div>

      <h4>Test errors</h4>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Client and Server</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              setTimeout(() => { throw new Error('Test client error'); }, 0);
            }}>Throw error</button>
            <button className="btn ml8" onClick={() => {
              Promise.reject(new Error('Test unhandled rejection'));
            }}>Unhandled rejection</button>
            <button className="btn ml8" onClick={() => {
              Meteor.call('nonexistent.method');
            }}>Fail method</button>
          </div>
        </div>
      </div>

      <h4>Token Statistics</h4>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Count Tokens</div>
          <div className="prefsValue">
            <button className="btn" disabled={countingTokens} onClick={countTokens}>
              {countingTokens ? 'Counting...' : 'Count All Tokens'}
            </button>
            <span style={{ marginLeft: '8px', color: 'var(--muted)', fontSize: '14px' }}>
              Analyze text content from all collections
            </span>
          </div>
        </div>

        {tokenStats && (
          <>
            <div className="prefsRow">
              <div className="prefsLabel">Global Summary</div>
              <div className="prefsValue">
                <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '6px', fontSize: '14px', lineHeight: '1.5' }}>
                  <div><strong>Total:</strong> {tokenStats.globalStats.totalTokens.toLocaleString()} tokens</div>
                  <div><strong>Items:</strong> {tokenStats.globalStats.totalItems.toLocaleString()} items</div>
                  <div><strong>Characters:</strong> {tokenStats.globalStats.totalCharacters.toLocaleString()}</div>
                  <div><strong>Average:</strong> {tokenStats.globalStats.avgTokensPerItem} tokens/item</div>
                  <div><strong>Ratio:</strong> {tokenStats.globalStats.tokensPerChar} tokens/character</div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Generated on {new Date(tokenStats.generatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <div className="prefsRow">
              <div className="prefsLabel">Collection Details</div>
              <div className="prefsValue">
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {Object.entries(tokenStats.collections).map(([collectionName, stats]) => (
                    <div key={collectionName} style={{ marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '13px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{collectionName}</div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>{stats.description}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', fontSize: '12px' }}>
                        <div><strong>Items:</strong> {stats.totalItems}</div>
                        <div><strong>With content:</strong> {stats.itemsWithContent}</div>
                        <div><strong>Tokens:</strong> {stats.tokens.toLocaleString()}</div>
                        <div><strong>Characters:</strong> {stats.characters.toLocaleString()}</div>
                        <div><strong>Average:</strong> {stats.avgTokensPerItem}</div>
                      </div>
                      {stats.error && (
                        <div style={{ color: 'var(--error)', marginTop: '4px', fontSize: '11px' }}>
                          Error: {stats.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};
