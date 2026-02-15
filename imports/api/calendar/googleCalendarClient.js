import { google } from 'googleapis';
import { getGoogleCalendarConfig } from '/imports/api/_shared/config';

let cachedClient = null;
let cachedAuth = null;
let cachedConfigKey = null;

/**
 * Get a Google Calendar API client.
 * @param {Object} [configOverride] - Optional config to use instead of appPreferences.
 *   Pass the result of getGoogleCalendarConfigAsync(userId) for user-aware access.
 */
export const getGoogleCalendarClient = (configOverride) => {
  const config = configOverride || getGoogleCalendarConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error('Google Calendar API credentials not configured');
  }

  // Cache key based on config to invalidate when credentials change
  const configKey = `${config.clientId}:${config.refreshToken || ''}`;

  // Return cached client if config hasn't changed
  if (cachedClient && cachedAuth && cachedConfigKey === configKey) {
    return { calendar: cachedClient, auth: cachedAuth };
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  if (config.refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: config.refreshToken
    });
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  cachedClient = calendar;
  cachedAuth = oauth2Client;
  cachedConfigKey = configKey;

  return { calendar, auth: oauth2Client };
};

export const getAuthUrl = (userId, configOverride) => {
  const config = configOverride || getGoogleCalendarConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error('Google Calendar API credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];

  const stateObj = {};
  if (userId) stateObj.userId = userId;
  const state = Object.keys(stateObj).length > 0 ? JSON.stringify(stateObj) : undefined;

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    ...(state ? { state } : {}),
  });

  return url;
};

export const exchangeCodeForTokens = async (code, configOverride) => {
  const config = configOverride || getGoogleCalendarConfig();

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};
