import { google } from 'googleapis';
import { getGoogleCalendarConfig } from '/imports/api/_shared/config';

let cachedClient = null;
let cachedAuth = null;

export const getGoogleCalendarClient = () => {
  const config = getGoogleCalendarConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error('Google Calendar API credentials not configured');
  }

  // Return cached client if config hasn't changed
  if (cachedClient && cachedAuth) {
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

  return { calendar, auth: oauth2Client };
};

export const getAuthUrl = () => {
  const config = getGoogleCalendarConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error('Google Calendar API credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  return url;
};

export const exchangeCodeForTokens = async (code) => {
  const config = getGoogleCalendarConfig();

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};
