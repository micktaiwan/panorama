import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';

// Core Meteor modules
// (already imported above)

// Projects & Tasks
import '/imports/api/projects/collections';
import '/imports/api/projects/publications';
import '/imports/api/projects/methods';
import '/imports/api/projects/aiMethods';
import '/imports/api/tasks/collections';
import '/imports/api/tasks/publications';
import '/imports/api/tasks/methods';
import '/imports/api/tasks/aiMethods';

// Notes & Documentation
import '/imports/api/notes/collections';
import '/imports/api/notes/publications';
import '/imports/api/notes/methods';
import '/imports/api/notes/aiMethods';
import '/imports/api/noteSessions/collections';
import '/imports/api/noteSessions/publications';
import '/imports/api/noteSessions/methods';
import '/imports/api/noteLines/collections';
import '/imports/api/noteLines/publications';
import '/imports/api/noteLines/methods';

// User Management & Teams
import '/imports/api/teams/collections';
import '/imports/api/teams/publications';
import '/imports/api/teams/methods';
import '/imports/api/people/collections';
import '/imports/api/people/publications';
import '/imports/api/people/methods';
import '/imports/api/userLogs/collections';
import '/imports/api/userLogs/publications';
import '/imports/api/userLogs/methods';
import '/imports/api/userLogs/aiMethods';

// Situations & Analysis
import '/imports/api/situations/collections';
import '/imports/api/situations/publications';
import '/imports/api/situations/methods';
import '/imports/api/situations/ai';
import '/imports/api/situationActors/collections';
import '/imports/api/situationActors/publications';
import '/imports/api/situationActors/methods';
import '/imports/api/situationNotes/collections';
import '/imports/api/situationNotes/publications';
import '/imports/api/situationNotes/methods';
import '/imports/api/situationQuestions/collections';
import '/imports/api/situationQuestions/publications';
import '/imports/api/situationQuestions/methods';
import '/imports/api/situationSummaries/collections';
import '/imports/api/situationSummaries/publications';
import '/imports/api/situationSummaries/methods';

// Communication & Chat
import '/imports/api/chat/methods';
import '/imports/api/chats/collections';
import '/imports/api/chats/publications';
import '/imports/api/chats/methods';

// MCP Server (Model Context Protocol)
import '/imports/api/mcp/server/routes';

// Budget & Financial
import '/imports/api/budget/collections';
import '/imports/api/budget/publications';
import '/imports/api/budget/methods';

// Calendar & Scheduling
import '/imports/api/calendar/collections';
import '/imports/api/calendar/publications';
import '/imports/api/calendar/methods';
import '/imports/api/alarms/collections';
import '/imports/api/alarms/publications';
import '/imports/api/alarms/methods';

// Files & Links
import '/imports/api/files/collections';
import '/imports/api/files/publications';
import '/imports/api/files/methods';
import '/imports/api/links/collections';
import '/imports/api/links/publications';
import '/imports/api/links/methods';

// Search & AI
import '/imports/api/search/qdrantInit';
import '/imports/api/search/methods';
import '/imports/api/sessions/aiMethods';

// Reporting & Export
import '/imports/api/reporting/methods';
import '/imports/api/reporting/ai';
import '/imports/api/export/methods';
import '/imports/api/export/server';

// System & Utilities
import '/imports/api/appPreferences/collections';
import '/imports/api/appPreferences/publications';
import '/imports/api/appPreferences/methods';
import '/imports/api/panorama/methods';
import '/imports/api/cron/jobs';

// Error Handling & Logging
import '/imports/api/errors/collections';
import '/imports/api/errors/publications';
import '/imports/api/errors/methods';
import '/imports/api/errors/serverConsoleOverride';

// Observability & Monitoring
import '/imports/api/toolCallLogs/collections';

// Gmail Integration
import '/imports/api/emails/collections';
import '/imports/api/emails/publications';
import '/imports/api/emails/methods';

Meteor.startup(async () => {
  // Ensure AI mode defaults to 'remote' on first launch
  const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
  const prefs = await AppPreferencesCollection.findOneAsync({});

  if (!prefs || !prefs.ai || !prefs.ai.mode) {
    console.log('[startup] No AI preferences found, initializing with remote mode');
    await AppPreferencesCollection.upsertAsync(
      {},
      {
        $set: {
          'ai.mode': 'remote',
          'ai.fallback': 'none'
        }
      }
    );
  } else if (prefs.ai.mode === 'auto') {
    // Legacy 'auto' mode no longer supported - force to remote
    console.log(`[startup] AI mode is 'auto' (deprecated), switching to 'remote'`);
    await AppPreferencesCollection.updateAsync(
      {},
      {
        $set: {
          'ai.mode': 'remote',
          'ai.fallback': 'none'
        }
      }
    );
  } else {
    console.log(`[startup] AI mode: '${prefs.ai.mode}'`);
  }

  // Place server-side initialization here as your app grows.
  const scriptSrc = Meteor.isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "connect-src 'self' ws: wss: http: https:"
  ].join('; ');

  WebApp.connectHandlers.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    next();
  });

  // Google Calendar OAuth callback
  WebApp.connectHandlers.use('/oauth/google-calendar/callback', async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>OAuth Error</h1><p>${error}</p><p>You can close this window.</p></body></html>`);
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Missing Code</h1><p>You can close this window.</p></body></html>');
      return;
    }

    try {
      const { exchangeCodeForTokens } = await import('/imports/api/calendar/googleCalendarClient.js');
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections.js');

      const tokens = await exchangeCodeForTokens(code);
      const now = new Date();
      const pref = await AppPreferencesCollection.findOneAsync({});

      if (!pref) {
        await AppPreferencesCollection.insertAsync({
          createdAt: now,
          updatedAt: now,
          googleCalendar: {
            refreshToken: tokens.refresh_token,
            lastSyncAt: null
          }
        });
      } else {
        await AppPreferencesCollection.updateAsync(pref._id, {
          $set: {
            'googleCalendar.refreshToken': tokens.refresh_token,
            updatedAt: now
          }
        });
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>✓ Connected to Google Calendar</h1>
            <p>You can close this window and return to Panorama.</p>
            <script>
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    } catch (e) {
      console.error('[OAuth callback] Failed to exchange code', e);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Error</h1><p>${e?.message || 'Failed to complete OAuth'}</p></body></html>`);
    }
  });
});
