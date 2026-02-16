import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';

// Inject data-theme on <html> from cookie — MUST be top-level (before Meteor.startup)
// so it's registered before the first HTTP response is sent.
WebApp.addHtmlAttributeHook((request) => {
  const cookieHeader = request.headers?.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)panorama-theme=([^;]+)/);
  if (match?.[1] === 'light') {
    return { 'data-theme': 'light' };
  }
  return {};
});

// --- Transient MongoDB error handler ---
// When the Mac sleeps, TCP connections to the remote MongoDB die.
// On wake, the driver throws PoolClearedOnNetworkError / MongoNetworkTimeoutError
// as unhandled rejections, which crash Node.js before the driver can reconnect.
const TRANSIENT_MONGO_ERRORS = new Set([
  'PoolClearedOnNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNetworkError',
  'MongoServerSelectionError',
]);

function isTransientMongoError(err) {
  if (!err) return false;
  const name = err.constructor?.name || err.name || '';
  if (TRANSIENT_MONGO_ERRORS.has(name)) return true;
  // Also check the cause chain (PoolClearedOnNetworkError wraps MongoNetworkTimeoutError)
  if (err.cause && isTransientMongoError(err.cause)) return true;
  return false;
}

process.on('unhandledRejection', (reason) => {
  if (isTransientMongoError(reason)) {
    console.warn(`[mongo] Transient network error (${reason.constructor?.name}), driver will reconnect: ${reason.message}`);
    return;
  }
  // Let Node.js handle non-transient rejections normally
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

// Accounts configuration (auth, rate limiting, email templates)
import '/server/accounts';

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
import '/imports/api/files/internalRoutes';
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
import '/imports/api/userPreferences/collections';
import '/imports/api/userPreferences/publications';
import '/imports/api/userPreferences/methods';
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

// Releases (global announcements)
import '/imports/api/releases/collections';
import '/imports/api/releases/publications';
import '/imports/api/releases/methods';

// Admin
import '/imports/api/admin/methods';
import '/imports/api/admin/publications';

Meteor.startup(async () => {
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

  // --- Admin bootstrap: promote first user if no admin exists ---
  const adminExists = await Meteor.users.findOneAsync({ isAdmin: true }, { fields: { _id: 1 } });
  if (!adminExists) {
    const firstUser = await Meteor.users.findOneAsync({}, { sort: { createdAt: 1 }, fields: { _id: 1 } });
    if (firstUser) {
      await Meteor.users.updateAsync(firstUser._id, { $set: { isAdmin: true } });
      console.log(`[startup] Promoted first user ${firstUser._id} to admin`);
    }
  }

  // --- Multi-user indexes (userId partitioning) ---
  const { ProjectsCollection } = await import('/imports/api/projects/collections');
  const { TasksCollection } = await import('/imports/api/tasks/collections');
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
  const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
  const { LinksCollection } = await import('/imports/api/links/collections');
  const { FilesCollection } = await import('/imports/api/files/collections');
  const { UserPreferencesCollection } = await import('/imports/api/userPreferences/collections');

  ProjectsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ProjectsCollection.rawCollection().createIndex({ memberIds: 1 }).catch(() => {});
  TasksCollection.rawCollection().createIndex({ userId: 1, projectId: 1 }).catch(() => {});
  TasksCollection.rawCollection().createIndex({ userId: 1, done: 1 }).catch(() => {});
  NotesCollection.rawCollection().createIndex({ userId: 1, projectId: 1 }).catch(() => {});
  NoteSessionsCollection.rawCollection().createIndex({ userId: 1, projectId: 1 }).catch(() => {});
  NoteLinesCollection.rawCollection().createIndex({ userId: 1, sessionId: 1 }).catch(() => {});
  NoteLinesCollection.rawCollection().createIndex({ projectId: 1 }).catch(() => {});
  LinksCollection.rawCollection().createIndex({ userId: 1, projectId: 1 }).catch(() => {});
  FilesCollection.rawCollection().createIndex({ userId: 1, projectId: 1 }).catch(() => {});
  UserPreferencesCollection.rawCollection().createIndex({ userId: 1 }, { unique: true }).catch(() => {});

  // Previously local-only collections - now userId-partitioned
  const { AlarmsCollection } = await import('/imports/api/alarms/collections');
  const { TeamsCollection } = await import('/imports/api/teams/collections');
  const { PeopleCollection } = await import('/imports/api/people/collections');
  const { SituationsCollection } = await import('/imports/api/situations/collections');
  const { SituationActorsCollection } = await import('/imports/api/situationActors/collections');
  const { SituationNotesCollection } = await import('/imports/api/situationNotes/collections');
  const { SituationQuestionsCollection } = await import('/imports/api/situationQuestions/collections');
  const { SituationSummariesCollection } = await import('/imports/api/situationSummaries/collections');
  const { BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection } = await import('/imports/api/budget/collections');
  const { ChatsCollection } = await import('/imports/api/chats/collections');
  const { ErrorsCollection } = await import('/imports/api/errors/collections');
  const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
  const { CalendarEventsCollection } = await import('/imports/api/calendar/collections');
  const { GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection } = await import('/imports/api/emails/collections');
  const { MCPServersCollection } = await import('/imports/api/mcpServers/collections');
  const { NotionIntegrationsCollection } = await import('/imports/api/notionIntegrations/collections');
  const { NotionTicketsCollection } = await import('/imports/api/notionTickets/collections');
  const { ClaudeCommandsCollection } = await import('/imports/api/claudeCommands/collections');

  AlarmsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  TeamsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  PeopleCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  SituationsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  SituationActorsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  SituationNotesCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  SituationQuestionsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  SituationSummariesCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  BudgetLinesCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  VendorsCacheCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  VendorsIgnoreCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ChatsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ErrorsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  UserLogsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  CalendarEventsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  GmailTokensCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  GmailMessagesCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  EmailActionLogsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  MCPServersCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  NotionIntegrationsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  NotionTicketsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ClaudeSessionsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ClaudeMessagesCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ClaudeProjectsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});
  ClaudeCommandsCollection.rawCollection().createIndex({ userId: 1 }).catch(() => {});

  const { ReleasesCollection } = await import('/imports/api/releases/collections');
  ReleasesCollection.rawCollection().createIndex({ createdAt: -1 }).catch(() => {});

  // --- Backfill userId on previously local-only collections ---
  // One-time migration: adds userId to documents that don't have one yet.
  // Uses localUserId from appPreferences as the owner for existing data.
  if (prefs && !prefs._userIdBackfilledLocal) {
    const backfillUserId = prefs.localUserId;
    if (backfillUserId) {
      console.log(`[startup] Backfilling userId="${backfillUserId}" on previously local-only collections...`);
      const backfillCollections = [
        AlarmsCollection, TeamsCollection, PeopleCollection,
        SituationsCollection, SituationActorsCollection, SituationNotesCollection,
        SituationQuestionsCollection, SituationSummariesCollection,
        BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection,
        ChatsCollection, ErrorsCollection, UserLogsCollection, CalendarEventsCollection,
        GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection,
        MCPServersCollection, NotionIntegrationsCollection, NotionTicketsCollection,
        ClaudeSessionsCollection, ClaudeMessagesCollection, ClaudeProjectsCollection,
        ClaudeCommandsCollection,
      ];
      let totalBackfilled = 0;
      for (const col of backfillCollections) {
        try {
          const result = await col.rawCollection().updateMany(
            { userId: { $exists: false } },
            { $set: { userId: backfillUserId } }
          );
          if (result.modifiedCount > 0) {
            console.log(`  ${col._name}: ${result.modifiedCount} docs backfilled`);
            totalBackfilled += result.modifiedCount;
          }
        } catch (e) {
          console.error(`  ${col._name}: backfill failed`, e.message);
        }
      }
      // Also backfill errors with userId: null → leave them (server-generated errors should stay userId: null)
      console.log(`[startup] Backfill complete: ${totalBackfilled} documents updated`);
      await AppPreferencesCollection.updateAsync(prefs._id, {
        $set: { _userIdBackfilledLocal: true, updatedAt: new Date() }
      });
    } else {
      console.log('[startup] Skipping userId backfill: localUserId not set in appPreferences');
    }
  }

  // --- Backfill memberIds on projects ---
  // One-time migration: adds memberIds: [userId] to all projects that don't have it yet.
  if (prefs && !prefs._memberIdsBackfilled) {
    console.log('[startup] Backfilling memberIds on projects...');
    let memberIdsCount = 0;
    const allProjects = await ProjectsCollection.find({ memberIds: { $exists: false } }).fetchAsync();
    for (const p of allProjects) {
      if (p.userId) {
        await ProjectsCollection.updateAsync(p._id, { $set: { memberIds: [p.userId] } });
        memberIdsCount++;
      }
    }
    console.log(`[startup] memberIds backfill: ${memberIdsCount} projects updated`);

    // Backfill projectId on noteLines from their parent session
    console.log('[startup] Backfilling projectId on noteLines...');
    let noteLinesCount = 0;
    const sessionsWithProject = await NoteSessionsCollection.find(
      { projectId: { $exists: true, $ne: null } },
      { fields: { _id: 1, projectId: 1 } }
    ).fetchAsync();
    for (const ses of sessionsWithProject) {
      const result = await NoteLinesCollection.rawCollection().updateMany(
        { sessionId: ses._id, projectId: { $exists: false } },
        { $set: { projectId: ses.projectId } }
      );
      noteLinesCount += result.modifiedCount;
    }
    console.log(`[startup] noteLines projectId backfill: ${noteLinesCount} lines updated`);

    await AppPreferencesCollection.updateAsync(prefs._id, {
      $set: { _memberIdsBackfilled: true, updatedAt: new Date() }
    });
  }

  // Place server-side initialization here as your app grows.
  // unsafe-eval required by Meteor's runtime (EJSON, DDP, dynamic imports)
  const scriptSrc = "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

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
    const stateRaw = url.searchParams.get('state');

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

    // Extract userId from OAuth state parameter
    let userId = null;
    if (stateRaw) {
      try {
        const stateObj = JSON.parse(stateRaw);
        userId = stateObj.userId || null;
      } catch (_e) {
        console.warn('[OAuth callback] Failed to parse state parameter:', stateRaw);
      }
    }

    try {
      const { exchangeCodeForTokens } = await import('/imports/api/calendar/googleCalendarClient.js');
      const tokens = await exchangeCodeForTokens(code);
      const now = new Date();

      if (userId) {
        // Save to userPreferences for the specific user
        const { UserPreferencesCollection } = await import('/imports/api/userPreferences/collections.js');
        const userPref = await UserPreferencesCollection.findOneAsync({ userId });

        const googleCalendar = {
          ...(userPref?.googleCalendar || {}),
          refreshToken: tokens.refresh_token,
          lastSyncAt: null
        };

        if (!userPref) {
          await UserPreferencesCollection.insertAsync({
            userId,
            createdAt: now,
            updatedAt: now,
            googleCalendar
          });
        } else {
          await UserPreferencesCollection.updateAsync(userPref._id, {
            $set: {
              googleCalendar,
              updatedAt: now
            }
          });
        }
      } else {
        // Fallback: no userId in state, save to appPreferences (legacy behavior)
        console.warn('[OAuth callback] No userId in state, saving to appPreferences as fallback');
        const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections.js');
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
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>Connected to Google Calendar</h1>
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
