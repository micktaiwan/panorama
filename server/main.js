import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
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

// Disk Files (read/write local filesystem)
import '/imports/api/diskFiles/methods';

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

// Notion Integration
import '/imports/api/notionIntegrations/collections';
import '/imports/api/notionIntegrations/publications';
import '/imports/api/notionIntegrations/methods';

// Notion Tickets (Persisted)
import '/imports/api/notionTickets/collections';
import '/imports/api/notionTickets/publications';
import '/imports/api/notionTickets/methods';

// MCP Servers Management
import '/imports/api/mcpServers/collections';
import '/imports/api/mcpServers/publications';
import '/imports/api/mcpServers/methods';

// Claude Code Projects & Sessions
import '/imports/api/claudeProjects/collections';
import '/imports/api/claudeProjects/publications';
import '/imports/api/claudeProjects/methods';
import '/imports/api/claudeSessions/collections';
import '/imports/api/claudeSessions/publications';
import '/imports/api/claudeSessions/methods';
import '/imports/api/claudeMessages/collections';
import '/imports/api/claudeMessages/publications';

// Claude Commands (custom slash commands)
import '/imports/api/claudeCommands/collections';
import '/imports/api/claudeCommands/publications';
import '/imports/api/claudeCommands/methods';

// Security
import '/imports/api/_shared/rateLimiter';

// Migrations
import '/server/migrations/addUserId';

Meteor.startup(async () => {
  // Audit: log login/logout events
  const { auditLog } = await import('/imports/api/_shared/audit');
  Accounts.onLogin(({ user }) => {
    auditLog('user.login', { userId: user._id, email: user.emails?.[0]?.address });
  });
  Accounts.onLoginFailure(({ error }) => {
    auditLog('user.loginFailure', { reason: error?.reason || error?.message });
  });
  Accounts.onLogout(({ user }) => {
    auditLog('user.logout', { userId: user?._id });
  });

  // Mark any Claude sessions stuck in "running" as interrupted (processes died on restart)
  const { ClaudeSessionsCollection } = await import('/imports/api/claudeSessions/collections');
  const { ClaudeMessagesCollection } = await import('/imports/api/claudeMessages/collections');
  const stuckSessions = await ClaudeSessionsCollection.find({ status: 'running' }).fetchAsync();
  if (stuckSessions.length > 0) {
    console.log(`[startup] Found ${stuckSessions.length} stuck Claude session(s), marking as interrupted`);
    for (const session of stuckSessions) {
      // Best-effort kill of zombie OS process
      if (session.pid) {
        try {
          process.kill(session.pid);
          console.log(`[startup] Killed zombie process ${session.pid} for session ${session._id}`);
        } catch (_) {
          // Process already dead — expected after restart
        }
      }
      // Mark session as interrupted
      await ClaudeSessionsCollection.updateAsync(session._id, {
        $set: { status: 'interrupted', pid: null, updatedAt: new Date() }
      });
      // Insert system message so user sees what happened
      await ClaudeMessagesCollection.insertAsync({
        sessionId: session._id,
        role: 'system',
        type: 'info',
        content: [{ type: 'text', text: 'Session interrupted by a server restart.' }],
        contentText: 'Session interrupted by a server restart.',
        createdAt: new Date(),
      });
    }
  }

  // Clear stale debate flags (processes died on restart)
  const staleDebates = await ClaudeSessionsCollection.updateAsync(
    { debateRunning: true },
    { $set: { debateRunning: false, debateRound: null, debateCurrentAgent: null, debateSubject: null } },
    { multi: true }
  );
  if (staleDebates > 0) {
    console.log(`[startup] Cleared ${staleDebates} stale debate flag(s)`);
  }

  // Migrate orphan Claude sessions (no projectId) into individual projects
  const { ClaudeProjectsCollection } = await import('/imports/api/claudeProjects/collections');
  const orphanSessions = await ClaudeSessionsCollection.find({ projectId: { $exists: false } }).fetchAsync();
  if (orphanSessions.length > 0) {
    console.log(`[startup] Migrating ${orphanSessions.length} orphan Claude session(s) into projects`);
    for (const session of orphanSessions) {
      const now = new Date();
      const projectId = await ClaudeProjectsCollection.insertAsync({
        name: session.name || 'Migrated Project',
        cwd: session.cwd,
        model: session.model,
        permissionMode: session.permissionMode,
        appendSystemPrompt: session.appendSystemPrompt,
        createdAt: session.createdAt || now,
        updatedAt: now,
      });
      await ClaudeSessionsCollection.updateAsync(session._id, {
        $set: { projectId, updatedAt: now },
      });
    }
    console.log(`[startup] Migration complete: ${orphanSessions.length} project(s) created`);
  }

  // AI preferences are now per-user; defaults are set when a user's prefs doc is first created.
  // Migrate any legacy global (userId-less) prefs docs by assigning them to auto mode.
  const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
  const legacyPrefs = await AppPreferencesCollection.find({ userId: { $exists: false } }).fetchAsync();
  if (legacyPrefs.length > 0) {
    console.log(`[startup] Found ${legacyPrefs.length} legacy appPreferences doc(s) without userId (will be claimed by first user to log in)`);
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

      const oauthUserId = url.searchParams.get('state') || null;
      const tokens = await exchangeCodeForTokens(code);
      const now = new Date();

      if (oauthUserId) {
        const pref = await AppPreferencesCollection.findOneAsync({ userId: oauthUserId });
        if (pref) {
          await AppPreferencesCollection.updateAsync(pref._id, {
            $set: { 'googleCalendar.refreshToken': tokens.refresh_token, updatedAt: now }
          });
        } else {
          await AppPreferencesCollection.insertAsync({
            userId: oauthUserId, createdAt: now, updatedAt: now,
            googleCalendar: { refreshToken: tokens.refresh_token, lastSyncAt: null }
          });
        }
      } else {
        console.warn('[OAuth] No userId in state param — storing token on first prefs doc found');
        const pref = await AppPreferencesCollection.findOneAsync({});
        if (pref) {
          await AppPreferencesCollection.updateAsync(pref._id, {
            $set: { 'googleCalendar.refreshToken': tokens.refresh_token, updatedAt: now }
          });
        }
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

  // Slack bot (Socket Mode)
  try {
    const { getSlackConfig } = await import('/imports/api/_shared/config');
    const sc = getSlackConfig();
    if (sc.enabled && sc.botToken && sc.appToken) {
      const { initSlackBot } = await import('/server/slack/bot');
      await initSlackBot();
    }
  } catch (e) {
    console.error('[startup] Slack bot failed', e);
  }
});
