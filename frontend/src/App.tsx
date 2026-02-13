import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ProjectsList } from './components/Projects/ProjectsList';
import { TasksList } from './components/Tasks/TasksList';
import { NotesList } from './components/Notes/NotesList';
import { PeopleList } from './components/People/PeopleList';
import { LinksList } from './components/Links/LinksList';
import { FilesList } from './components/Files/FilesList';
import { AlarmsList } from './components/Alarms/AlarmsList';
import { SearchPanel } from './components/Search/SearchPanel';
import { BudgetView } from './components/Budget/BudgetView';
import { CalendarView } from './components/Calendar/CalendarView';
import { SituationsView } from './components/Situations/SituationsView';
import { UserLogsView } from './components/UserLogs/UserLogsView';
import { Terminal } from './components/Terminal/Terminal';
import { MCPServersView } from './components/MCPServers/MCPServersView';
import { NotionView } from './components/Notion/NotionView';
import { GmailView } from './components/Gmail/GmailView';
import { DataTransfer } from './components/DataTransfer/DataTransfer';
import { ClaudeCodeView } from './components/ClaudeCode/ClaudeCodeView';
import './App.css';

type Tab = 'dashboard' | 'projects' | 'tasks' | 'notes' | 'people' | 'links' | 'files' | 'alarms' | 'budget' | 'calendar' | 'situations' | 'logs' | 'search' | 'mcp' | 'notion' | 'gmail' | 'data' | 'terminal' | 'claude';

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Accueil',
  projects: 'Projets',
  tasks: 'Tâches',
  notes: 'Notes',
  people: 'Personnes',
  links: 'Liens',
  files: 'Fichiers',
  alarms: 'Alarmes',
  budget: 'Budget',
  calendar: 'Calendrier',
  situations: 'Situations',
  logs: 'Journal',
  search: 'Recherche',
  mcp: 'MCP',
  notion: 'Notion',
  gmail: 'Gmail',
  data: 'Import/Export',
  terminal: 'Terminal',
  claude: 'Claude',
};

const ALL_TABS: Tab[] = ['dashboard', 'projects', 'tasks', 'notes', 'people', 'links', 'files', 'alarms', 'budget', 'calendar', 'situations', 'logs', 'search', 'mcp', 'notion', 'gmail', 'data', 'terminal', 'claude'];

function App() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    return (localStorage.getItem('panoramix-tab') as Tab) || 'dashboard';
  });

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    localStorage.setItem('panoramix-tab', tab);
  };

  if (isLoading) {
    return <div className="app-loading">Panoramix...</div>;
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-logo">Panoramix</h1>
          <nav className="app-nav">
            {ALL_TABS.map(tab => (
              <button
                key={tab}
                className={`nav-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </nav>
        </div>
        <div className="header-right">
          <button className="theme-btn" onClick={toggleTheme}>
            {isDarkMode ? '☀' : '☾'}
          </button>
          <span className="user-name">{user?.displayName}</span>
          <button className="logout-btn" onClick={logout}>Déconnexion</button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'projects' && <ProjectsList />}
        {activeTab === 'tasks' && <TasksList />}
        {activeTab === 'notes' && <NotesList />}
        {activeTab === 'people' && <PeopleList />}
        {activeTab === 'links' && <LinksList />}
        {activeTab === 'files' && <FilesList />}
        {activeTab === 'alarms' && <AlarmsList />}
        {activeTab === 'budget' && <BudgetView />}
        {activeTab === 'calendar' && <CalendarView />}
        {activeTab === 'situations' && <SituationsView />}
        {activeTab === 'logs' && <UserLogsView />}
        {activeTab === 'search' && <SearchPanel />}
        {activeTab === 'mcp' && <MCPServersView />}
        {activeTab === 'notion' && <NotionView />}
        {activeTab === 'gmail' && <GmailView />}
        {activeTab === 'data' && <DataTransfer />}
        {activeTab === 'terminal' && <Terminal />}
        {activeTab === 'claude' && <ClaudeCodeView />}
      </main>
    </div>
  );
}

export default App;
