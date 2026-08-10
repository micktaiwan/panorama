// Describes what the user is currently looking at, so the chat agent can
// resolve "cette tâche", "ce projet", "cette note" without asking.
// Ids are resolved to human labels from minimongo when the document is
// already published; otherwise only the id is sent and the agent can look it up.

import { parseHashRoute } from '/imports/ui/router.js';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { PeopleCollection } from '/imports/api/people/collections';

const PAGE_LABELS = {
  home: 'Home',
  dashboard: 'Dashboard',
  project: 'Project details',
  projectDelete: 'Project deletion',
  session: 'Note session',
  notes: 'Notes',
  people: 'People',
  eisenhower: 'Eisenhower matrix',
  calendar: 'Calendar',
  panorama: 'Panorama overview',
  links: 'Links',
  files: 'Files',
  alarms: 'Alarms',
  emails: 'Emails',
  inboxZero: 'Inbox Zero',
  userlog: 'Journal',
  reporting: 'Reporting',
  budget: 'Budget',
  releases: 'Releases',
  preferences: 'Preferences',
  claude: 'Claude Code',
  help: 'Help'
};

/**
 * Snapshot of the current page, safe to send to the server.
 * Returns null when there is nothing useful to say (login screens, unknown routes).
 */
export const buildPageContext = () => {
  const route = parseHashRoute();
  if (!route?.name) return null;
  if (['login', 'signup', 'forgotPassword', 'resetPassword', 'verifyEmail'].includes(route.name)) return null;

  const context = {
    page: PAGE_LABELS[route.name] || route.name,
    route: route.name,
    hash: window.location.hash || '#/'
  };

  if (route.projectId) {
    context.projectId = route.projectId;
    const project = ProjectsCollection.findOne(route.projectId, { fields: { name: 1 } });
    if (project?.name) context.projectName = project.name;
  }
  if (route.noteId) {
    context.noteId = route.noteId;
    const note = NotesCollection.findOne(route.noteId, { fields: { title: 1 } });
    if (note?.title) context.noteTitle = note.title;
  }
  if (route.sessionId) {
    context.sessionId = route.sessionId;
    const session = NoteSessionsCollection.findOne(route.sessionId, { fields: { name: 1 } });
    if (session?.name) context.sessionName = session.name;
  }
  if (route.personId) {
    context.personId = route.personId;
    const person = PeopleCollection.findOne(route.personId, { fields: { name: 1 } });
    if (person?.name) context.personName = person.name;
  }
  if (route.tab) context.tab = route.tab;

  return context;
};
