export const parseHashRoute = () => {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  // Auth routes
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'signup') return { name: 'signup' };
  if (parts[0] === 'forgot-password') return { name: 'forgotPassword' };
  if (parts[0] === 'reset-password' && parts[1]) return { name: 'resetPassword', token: parts[1] };
  if (parts[0] === 'verify-email' && parts[1]) return { name: 'verifyEmail', token: parts[1] };
  if (parts[0] === 'dashboard') return { name: 'dashboard' };
  if (parts[0] === 'help') return { name: 'help' };
  if (parts[0] === 'alarms') return { name: 'alarms' };
  // qdrant route removed; integrated into Preferences
  if (parts[0] === 'eisenhower') return { name: 'eisenhower' };
  if (parts[0] === 'links') return { name: 'links' };
  if (parts[0] === 'files') return { name: 'files' };
  if (parts[0] === 'onboarding') return { name: 'onboarding' };
  if (parts[0] === 'preferences' && parts[1] === 'search-quality') return { name: 'searchQuality' };
  if (parts[0] === 'preferences') return { name: 'preferences', tab: parts[1] || 'general' };
  if (parts[0] === 'web') return { name: 'web' };
  if (parts[0] === 'reporting') return { name: 'reporting' };
  if (parts[0] === 'userlog') return { name: 'userlog' };
  if (parts[0] === 'calendar') return { name: 'calendar' };
  if (parts[0] === 'panorama') return { name: 'panorama' };
  if (parts[0] === 'people') return { name: 'people', personId: parts[1] };
  if (parts[0] === 'situation-analyzer') return { name: 'situationAnalyzer' };
  if (parts[0] === 'budget') return { name: 'budget', tab: parts[1] || 'report' };
  if (parts[0] === 'projects' && parts[1] && parts[2] === 'delete') return { name: 'projectDelete', projectId: parts[1] };
  if (parts[0] === 'projects' && parts[1]) return { name: 'project', projectId: parts[1] };
  if (parts[0] === 'sessions' && parts[1]) return { name: 'session', sessionId: parts[1] };
  if (parts[0] === 'import-tasks') return { name: 'importTasks' };
  if (parts[0] === 'notes') return { name: 'notes', noteId: parts[1] };
  if (parts[0] === 'emails') return { name: 'emails' };
  if (parts[0] === 'inbox-zero') return { name: 'inboxZero' };
  if (parts[0] === 'notion-reporting') return { name: 'notionReporting' };
  if (parts[0] === 'mcp-servers') return { name: 'mcpServers' };
  if (parts[0] === 'claude') return { name: 'claude', projectId: parts[1] };
  if (parts[0] === 'releases') return { name: 'releases', releaseId: parts[1] };
  if (parts[0] === 'admin') return { name: 'admin', tab: parts[1] || 'users' };
  return { name: 'home' };
};

export const navigateTo = (route) => {
  switch (route.name) {
    case 'home':
      window.location.hash = '#/';
      break;
    // Auth routes
    case 'login':
      window.location.hash = '#/login';
      break;
    case 'signup':
      window.location.hash = '#/signup';
      break;
    case 'forgotPassword':
      window.location.hash = '#/forgot-password';
      break;
    case 'resetPassword':
      window.location.hash = `#/reset-password/${route.token}`;
      break;
    case 'verifyEmail':
      window.location.hash = `#/verify-email/${route.token}`;
      break;
    case 'project':
      window.location.hash = `#/projects/${route.projectId}`;
      break;
    case 'session':
      window.location.hash = `#/sessions/${route.sessionId}`;
      break;
    case 'dashboard':
      window.location.hash = '#/dashboard';
      break;
    case 'help':
      window.location.hash = '#/help';
      break;
    case 'alarms':
      window.location.hash = '#/alarms';
      break;
    case 'eisenhower':
      window.location.hash = '#/eisenhower';
      break;
    case 'links':
      window.location.hash = '#/links';
      break;
    case 'files':
      window.location.hash = '#/files';
      break;
    case 'onboarding':
      window.location.hash = '#/onboarding';
      break;
    case 'preferences':
      window.location.hash = route.tab && route.tab !== 'general' ? `#/preferences/${route.tab}` : '#/preferences';
      break;
    case 'searchQuality':
      window.location.hash = '#/preferences/search-quality';
      break;
    case 'web':
      window.location.hash = '#/web';
      break;
    case 'reporting':
      window.location.hash = '#/reporting';
      break;
    case 'calendar':
      window.location.hash = '#/calendar';
      break;
    case 'panorama':
      window.location.hash = '#/panorama';
      break;
    case 'userlog':
      window.location.hash = '#/userlog';
      break;
    case 'people':
      window.location.hash = route.personId ? `#/people/${route.personId}` : '#/people';
      break;
    case 'situationAnalyzer':
      window.location.hash = '#/situation-analyzer';
      break;
    case 'budget':
      window.location.hash = `#/budget/${route.tab || 'report'}`;
      break;
    case 'projectDelete':
      window.location.hash = `#/projects/${route.projectId}/delete`;
      break;
    case 'importTasks':
      window.location.hash = '#/import-tasks';
      break;
    case 'notes':
      window.location.hash = route.noteId ? `#/notes/${route.noteId}` : '#/notes';
      break;
    case 'emails':
      window.location.hash = '#/emails';
      break;
    case 'inboxZero':
      window.location.hash = '#/inbox-zero';
      break;
    case 'notionReporting':
      window.location.hash = '#/notion-reporting';
      break;
    case 'mcpServers':
      window.location.hash = '#/mcp-servers';
      break;
    case 'claude':
      window.location.hash = route.projectId ? `#/claude/${route.projectId}` : '#/claude';
      break;
    case 'releases':
      window.location.hash = route.releaseId ? `#/releases/${route.releaseId}` : '#/releases';
      break;
    case 'admin':
      window.location.hash = route.tab && route.tab !== 'users' ? `#/admin/${route.tab}` : '#/admin';
      break;
    default:
      window.location.hash = '#/';
  }
};
