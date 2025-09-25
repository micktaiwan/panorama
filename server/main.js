import { Meteor } from 'meteor/meteor';
import '/imports/api/projects/collections';
import '/imports/api/projects/publications';
import '/imports/api/projects/methods';
import '/imports/api/tasks/collections';
import '/imports/api/tasks/publications';
import '/imports/api/tasks/methods';
import '/imports/api/notes/collections';
import '/imports/api/notes/publications';
import '/imports/api/notes/methods';
import '/imports/api/noteSessions/collections';
import '/imports/api/noteSessions/publications';
import '/imports/api/noteSessions/methods';
import '/imports/api/noteLines/collections';
import '/imports/api/noteLines/publications';
import '/imports/api/noteLines/methods';
import '/imports/api/notes/aiMethods';
import '/imports/api/userLogs/aiMethods';
import '/imports/api/sessions/aiMethods';
import '/imports/api/projects/aiMethods';
import '/imports/api/tasks/aiMethods';
import '/imports/api/export/methods';
import '/imports/api/alarms/collections';
import '/imports/api/alarms/publications';
import '/imports/api/alarms/methods';
import '/imports/api/links/collections';
import '/imports/api/links/publications';
import '/imports/api/links/methods';
import '/imports/api/appPreferences/collections';
import '/imports/api/appPreferences/publications';
import '/imports/api/appPreferences/methods';
import '/imports/api/files/collections';
import '/imports/api/files/publications';
import '/imports/api/files/methods';
import '/imports/api/export/server';
import '/imports/api/search/qdrantInit';
import '/imports/api/search/methods';
import '/imports/api/budget/collections';
import '/imports/api/budget/publications';
import '/imports/api/budget/methods';
import '/imports/api/reporting/methods';
import '/imports/api/reporting/ai';
import '/imports/api/panorama/methods';
import '/imports/api/teams/collections';
import '/imports/api/teams/publications';
import '/imports/api/teams/methods';
import '/imports/api/people/collections';
import '/imports/api/people/publications';
import '/imports/api/people/methods';
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
import '/imports/api/errors/collections';
import '/imports/api/errors/publications';
import '/imports/api/errors/methods';
import '/imports/api/errors/serverConsoleOverride';
import '/imports/api/chat/methods';
import '/imports/api/chats/collections';
import '/imports/api/chats/publications';
import '/imports/api/chats/methods';
import '/imports/api/userLogs/collections';
import '/imports/api/userLogs/publications';
import '/imports/api/userLogs/methods';
import '/imports/api/cron/jobs';
import '/imports/api/calendar/collections';
import '/imports/api/calendar/publications';
import '/imports/api/calendar/methods';
import { WebApp } from 'meteor/webapp';

Meteor.startup(() => {
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
});
