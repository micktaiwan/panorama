import { useState, useEffect, useCallback, useRef } from 'react';
import { claudeCode, projects as projectsApi } from '../../services/api';
import { socketService } from '../../services/socket';
import { ProjectList } from './ProjectList';
import { SessionView } from './SessionView';
import type { ClaudeProject, ClaudeSession, Project } from '../../types';
import './ClaudeCodeView.css';

const STORAGE_KEY = 'cc-activeProject';
const SESSION_STORAGE_KEY = 'cc-activeSession';

export function ClaudeCodeView() {
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    localStorage.getItem(SESSION_STORAGE_KEY)
  );
  const [homeDir, setHomeDir] = useState('');
  const [normalProjects, setNormalProjects] = useState<Project[]>([]);
  const subscribedProject = useRef<string | null>(null);

  // Load home dir + normal projects
  useEffect(() => {
    claudeCode.getHomeDir().then(r => setHomeDir(r.homeDir)).catch(() => {});
    projectsApi.list().then(r => setNormalProjects(r.projects)).catch(() => {});
  }, []);

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const { projects: p } = await claudeCode.listProjects();
      setProjects(p);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Load sessions when project changes
  useEffect(() => {
    if (!activeProjectId) {
      setSessions([]);
      return;
    }
    localStorage.setItem(STORAGE_KEY, activeProjectId);
    claudeCode.listSessions(activeProjectId)
      .then(r => {
        setSessions(r.sessions);
        // Restore or auto-select session
        const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
        if (savedSession && r.sessions.find(s => s._id === savedSession)) {
          setActiveSessionId(savedSession);
        } else if (r.sessions.length > 0) {
          setActiveSessionId(r.sessions[0]._id);
        } else {
          setActiveSessionId(null);
        }
      })
      .catch(err => console.error('Failed to load sessions:', err));
  }, [activeProjectId]);

  // Persist active session
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
    }
  }, [activeSessionId]);

  // Socket subscriptions for project
  useEffect(() => {
    if (subscribedProject.current) {
      socketService.unsubscribeClaudeProject(subscribedProject.current);
    }
    if (activeProjectId) {
      socketService.subscribeClaudeProject(activeProjectId);
      subscribedProject.current = activeProjectId;
    }

    const onSessionUpdated = (data: unknown) => {
      const d = data as ClaudeSession;
      setSessions(prev => prev.map(s => s._id === d._id ? d : s));
    };

    const unsubUpdated = socketService.on('claude:session:updated', onSessionUpdated);
    return () => {
      unsubUpdated();
      if (subscribedProject.current) {
        socketService.unsubscribeClaudeProject(subscribedProject.current);
        subscribedProject.current = null;
      }
    };
  }, [activeProjectId]);

  const handleSelectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const handleProjectCreated = useCallback((project: ClaudeProject) => {
    setProjects(prev => [project, ...prev]);
    setActiveProjectId(project._id);
  }, []);

  const handleProjectDeleted = useCallback((projectId: string) => {
    setProjects(prev => prev.filter(p => p._id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setActiveSessionId(null);
    }
  }, [activeProjectId]);

  const handleSessionCreated = useCallback((session: ClaudeSession) => {
    setSessions(prev => [...prev, session]);
    setActiveSessionId(session._id);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s._id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next.length > 0 ? next[0]._id : null);
      }
      return next;
    });
  }, [activeSessionId]);

  const activeProject = projects.find(p => p._id === activeProjectId);

  return (
    <div className="cc-layout">
      <ProjectList
        projects={projects}
        sessions={sessions}
        normalProjects={normalProjects}
        activeProjectId={activeProjectId}
        activeSessionId={activeSessionId}
        homeDir={homeDir}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
        onProjectCreated={handleProjectCreated}
        onProjectDeleted={handleProjectDeleted}
        onSessionCreated={handleSessionCreated}
        onSessionDeleted={handleSessionDeleted}
        onProjectsChanged={loadProjects}
      />
      <div className="cc-main">
        {!activeProjectId && (
          <div className="cc-empty">
            <p>Sélectionner ou créer un projet pour commencer.</p>
          </div>
        )}
        {activeProjectId && sessions.length === 0 && (
          <div className="cc-empty">
            <p>Aucune session. Créez-en une depuis la sidebar.</p>
          </div>
        )}
        {activeSessionId && (
          <SessionView
            key={activeSessionId}
            sessionId={activeSessionId}
            session={sessions.find(s => s._id === activeSessionId)}
            homeDir={homeDir}
            projectCwd={activeProject?.cwd || ''}
          />
        )}
      </div>
    </div>
  );
}
