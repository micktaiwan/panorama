export const parseHashRoute = () => {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'dashboard') return { name: 'home' };
  if (parts[0] === 'help') return { name: 'help' };
  if (parts[0] === 'alarms') return { name: 'alarms' };
  // qdrant route removed; integrated into Preferences
  if (parts[0] === 'eisenhower') return { name: 'eisenhower' };
  if (parts[0] === 'links') return { name: 'links' };
  if (parts[0] === 'files') return { name: 'files' };
  if (parts[0] === 'onboarding') return { name: 'onboarding' };
  if (parts[0] === 'preferences') return { name: 'preferences' };
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
  return { name: 'home' };
};

export const navigateTo = (route) => {
  switch (route.name) {
    case 'home':
      window.location.hash = '#/';
      break;
    case 'project':
      window.location.hash = `#/projects/${route.projectId}`;
      break;
    case 'session':
      window.location.hash = `#/sessions/${route.sessionId}`;
      break;
    case 'dashboard':
      window.location.hash = '#/';
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
      window.location.hash = '#/preferences';
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
    default:
      window.location.hash = '#/';
  }
};
