export const PEOPLE_FILTER_TEXT_KEY = 'people_filter_text';
export const PEOPLE_FILTER_TEAM_KEY = 'people_filter_team';
export const PEOPLE_FILTER_SUBTEAM_KEY = 'people_filter_subteam';

export const loadPeopleFilters = () => {
  if (typeof localStorage === 'undefined') return { text: '', team: '', subteam: '' };
  return {
    text: localStorage.getItem(PEOPLE_FILTER_TEXT_KEY) || '',
    team: localStorage.getItem(PEOPLE_FILTER_TEAM_KEY) || '',
    subteam: localStorage.getItem(PEOPLE_FILTER_SUBTEAM_KEY) || ''
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

export const savePeopleSubteamFilter = (subteam) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PEOPLE_FILTER_SUBTEAM_KEY, subteam || '');
};


