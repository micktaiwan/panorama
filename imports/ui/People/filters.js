export const PEOPLE_FILTER_TEXT_KEY = 'people_filter_text';
export const PEOPLE_FILTER_TEAM_KEY = 'people_filter_team';

export const loadPeopleFilters = () => {
  if (typeof localStorage === 'undefined') return { text: '', team: '' };
  return {
    text: localStorage.getItem(PEOPLE_FILTER_TEXT_KEY) || '',
    team: localStorage.getItem(PEOPLE_FILTER_TEAM_KEY) || ''
  };
};

export const savePeopleTextFilter = (text) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PEOPLE_FILTER_TEXT_KEY, text || '');
};

export const savePeopleTeamFilter = (teamId) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PEOPLE_FILTER_TEAM_KEY, teamId || '');
};


