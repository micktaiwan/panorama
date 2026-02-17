import React from 'react';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { navigateTo } from '../router.js';
import { notify } from '../utils/notify.js';

export const PrefsSecrets = ({ pref: _pref, userPref }) => {
  const [openaiApiKey, setOpenaiApiKey] = React.useState('');
  const [anthropicApiKey, setAnthropicApiKey] = React.useState('');
  const [perplexityApiKey, setPerplexityApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  const [calendarIcsUrl, setCalendarIcsUrl] = React.useState('');
  const [googleCalendarClientId, setGoogleCalendarClientId] = React.useState('');
  const [googleCalendarClientSecret, setGoogleCalendarClientSecret] = React.useState('');
  const [googleCalendarConnected, setGoogleCalendarConnected] = React.useState(false);
  const [_googleCalendarAuthUrl, setGoogleCalendarAuthUrl] = React.useState('');
  const [googleCalendarLastSync, setGoogleCalendarLastSync] = React.useState(null);
  const [slackEnabled, setSlackEnabled] = React.useState(false);
  const [slackBotToken, setSlackBotToken] = React.useState('');
  const [slackAppToken, setSlackAppToken] = React.useState('');
  const [slackAllowedUserId, setSlackAllowedUserId] = React.useState('');

  React.useEffect(() => {
    if (!userPref) return;
    setOpenaiApiKey(userPref.openaiApiKey || '');
    setAnthropicApiKey(userPref.anthropicApiKey || '');
    setPerplexityApiKey(userPref.perplexityApiKey || '');
    setPennyBaseUrl(userPref.pennylaneBaseUrl || '');
    setPennyToken(userPref.pennylaneToken || '');
    setCalendarIcsUrl(userPref.calendarIcsUrl || '');
    setGoogleCalendarClientId(userPref.googleCalendar?.clientId || '');
    setGoogleCalendarClientSecret(userPref.googleCalendar?.clientSecret || '');
    setGoogleCalendarConnected(!!(userPref.googleCalendar?.refreshToken));
    setGoogleCalendarLastSync(userPref.googleCalendar?.lastSyncAt || null);
    setSlackEnabled(!!userPref.slack?.enabled);
    setSlackBotToken(userPref.slack?.botToken || '');
    setSlackAppToken(userPref.slack?.appToken || '');
    setSlackAllowedUserId(userPref.slack?.allowedUserId || '');
  /* eslint-disable react-hooks/exhaustive-deps */
  }, [userPref?._id, userPref?.openaiApiKey, userPref?.anthropicApiKey, userPref?.perplexityApiKey,
      userPref?.pennylaneBaseUrl, userPref?.pennylaneToken, userPref?.calendarIcsUrl,
      JSON.stringify(userPref?.googleCalendar), JSON.stringify(userPref?.slack)]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <>
      <h3>Secrets</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">OpenAI API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={openaiApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setOpenaiApiKey(next);
                Meteor.call('userPreferences.update', { openaiApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Anthropic API Key (Chat)</div>
          <div className="prefsValue">
            <InlineEditable
              value={anthropicApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setAnthropicApiKey(next);
                Meteor.call('userPreferences.update', { anthropicApiKey: next }, () => {});
              }}
            />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Utilisé par le chat AI (Claude SDK avec toolRunner)
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Perplexity API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={perplexityApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPerplexityApiKey(next);
                Meteor.call('userPreferences.update', { perplexityApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Google Calendar API</div>
          <div className="prefsValue">
            {googleCalendarConnected ? (
              <div>
                <div style={{ color: '#0b6', marginBottom: '8px' }}>Connected to Google Calendar</div>
                {googleCalendarLastSync ? (
                  <div className="muted" style={{ fontSize: '13px', marginBottom: '8px' }}>
                    Last sync: {new Date(googleCalendarLastSync).toLocaleString()}
                  </div>
                ) : null}
                <button
                  className="btn"
                  onClick={() => {
                    Meteor.call('calendar.google.sync', null, (err, res) => {
                      if (err) { notify({ message: err?.reason || err?.message || 'Sync failed', kind: 'error' }); return; }
                      notify({ message: `Synced ${res?.upserts || 0} events from ${res?.calendars || 0} calendars`, kind: 'success' });
                    });
                  }}
                >Sync Now</button>
                <a className="btn-link ml8" href="#/calendar" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'calendar' }); }}>Open Calendar</a>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '12px' }}>
                  <input
                    className="afInput"
                    type="text"
                    placeholder="Client ID"
                    value={googleCalendarClientId}
                    onChange={(e) => setGoogleCalendarClientId(e.target.value)}
                    style={{ width: '100%', marginBottom: '8px' }}
                  />
                  <input
                    className="afInput"
                    type="password"
                    placeholder="Client Secret"
                    value={googleCalendarClientSecret}
                    onChange={(e) => setGoogleCalendarClientSecret(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    if (!googleCalendarClientId?.trim() || !googleCalendarClientSecret?.trim()) {
                      notify({ message: 'Client ID and Secret required', kind: 'error' });
                      return;
                    }
                    Meteor.call('userPreferences.update', {
                      googleCalendar: {
                        clientId: googleCalendarClientId.trim(),
                        clientSecret: googleCalendarClientSecret.trim()
                      }
                    }, (err) => {
                      if (err) { notify({ message: err?.reason || err?.message || 'Save failed', kind: 'error' }); return; }
                      Meteor.call('calendar.google.getAuthUrl', (err2, res) => {
                        if (err2) { notify({ message: err2?.reason || err2?.message || 'Auth URL failed', kind: 'error' }); return; }
                        setGoogleCalendarAuthUrl(res?.url || '');
                        window.open(res?.url, '_blank');
                        notify({ message: 'Complete OAuth in the new window', kind: 'info' });
                      });
                    });
                  }}
                >Connect Google Calendar</button>
                <div className="muted mt8" style={{ fontSize: '12px' }}>
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Get credentials from Google Cloud Console</a>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Google Calendar (Legacy ICS)</div>
          <div className="prefsValue">
            <div>
              <input
                className="afInput"
                type="text"
                placeholder="Paste your private ICS URL"
                value={calendarIcsUrl}
                onChange={(e) => setCalendarIcsUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div className="mt8">
              <button
                className="btn"
                onClick={() => {
                  const url = String(calendarIcsUrl || '').trim();
                  if (!url) { notify({ message: 'ICS URL missing', kind: 'error' }); return; }
                  Meteor.call('calendar.setIcsUrl', url, (err) => {
                    if (err) { notify({ message: err?.reason || err?.message || 'Save failed', kind: 'error' }); return; }
                    notify({ message: 'ICS URL saved', kind: 'success' });
                  });
                }}
              >Link with GCal (ICS)</button>
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">MCP Servers</div>
          <div className="prefsValue">
            <div className="muted" style={{ marginBottom: '8px', fontSize: '13px' }}>
              Configure external MCP servers (Notion, Google Calendar, etc.)
            </div>
            <button
              className="btn"
              onClick={() => navigateTo({ name: 'mcpServers' })}
            >
              Manage MCP Servers
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Slack Integration</div>
          <div className="prefsValue">
            <div style={{ marginBottom: '8px' }}>
              <InlineEditable
                as="select"
                value={slackEnabled ? 'enabled' : 'disabled'}
                options={[{ value: 'disabled', label: 'Disabled' }, { value: 'enabled', label: 'Enabled' }]}
                onSubmit={(next) => {
                  const v = next === 'enabled';
                  setSlackEnabled(v);
                  Meteor.call('userPreferences.update', { slack: { enabled: v, botToken: slackBotToken, appToken: slackAppToken, allowedUserId: slackAllowedUserId } }, () => {});
                }}
              />
            </div>
            {slackEnabled && (
              <div>
                <div style={{ marginBottom: '8px' }}>
                  <div className="muted" style={{ fontSize: '12px', marginBottom: '4px' }}>Bot Token (xoxb-...)</div>
                  <InlineEditable
                    value={slackBotToken}
                    placeholder="xoxb-..."
                    fullWidth
                    onSubmit={(next) => {
                      setSlackBotToken(next);
                      Meteor.call('userPreferences.update', { slack: { enabled: slackEnabled, botToken: next, appToken: slackAppToken, allowedUserId: slackAllowedUserId } }, () => {});
                    }}
                  />
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <div className="muted" style={{ fontSize: '12px', marginBottom: '4px' }}>App Token (xapp-...)</div>
                  <InlineEditable
                    value={slackAppToken}
                    placeholder="xapp-..."
                    fullWidth
                    onSubmit={(next) => {
                      setSlackAppToken(next);
                      Meteor.call('userPreferences.update', { slack: { enabled: slackEnabled, botToken: slackBotToken, appToken: next, allowedUserId: slackAllowedUserId } }, () => {});
                    }}
                  />
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <div className="muted" style={{ fontSize: '12px', marginBottom: '4px' }}>Allowed User ID (U...)</div>
                  <InlineEditable
                    value={slackAllowedUserId}
                    placeholder="U0123456789"
                    fullWidth
                    onSubmit={(next) => {
                      setSlackAllowedUserId(next);
                      Meteor.call('userPreferences.update', { slack: { enabled: slackEnabled, botToken: slackBotToken, appToken: slackAppToken, allowedUserId: next } }, () => {});
                    }}
                  />
                </div>
                <div className="muted" style={{ fontSize: '12px' }}>
                  Requires Meteor restart to take effect
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Base URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyBaseUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyBaseUrl(next);
                Meteor.call('userPreferences.update', { pennylaneBaseUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Token</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyToken}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyToken(next);
                Meteor.call('userPreferences.update', { pennylaneToken: next }, () => {});
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};
