import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { Dashboard } from '/imports/ui/Dashboard/Dashboard.jsx';
import { Help } from '/imports/ui/Help/Help.jsx';
import { ProjectDetails } from '/imports/ui/ProjectDetails/projectDetails.jsx';
import { NoteSession } from '/imports/ui/NoteSession/NoteSession.jsx';
import { ProjectDelete } from '/imports/ui/ProjectDelete/ProjectDelete.jsx';
import './App.css';
import { parseHashRoute, navigateTo } from '/imports/ui/router.js';
import { ImportTasks } from '/imports/ui/ImportTasks/ImportTasks.jsx';
import { Alarms } from '/imports/ui/Alarms/Alarms.jsx';
import { LinksPage } from '/imports/ui/Links/LinksPage.jsx';
import { FilesPage } from '/imports/ui/Files/FilesPage.jsx';
import { Eisenhower } from '/imports/ui/Eisenhower/Eisenhower.jsx';
import { BudgetPage } from '/imports/ui/Budget/BudgetPage.jsx';
import { ReportingPage } from '/imports/ui/Reporting/ReportingPage.jsx';
import { SituationAnalyzer } from '/imports/ui/SituationAnalyzer/SituationAnalyzer.jsx';
import { PeoplePage } from '/imports/ui/People/PeoplePage.jsx';
import { useAlarmScheduler } from '/imports/ui/hooks/useAlarmScheduler.js';
import { useTracker, useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { AlarmModal } from '/imports/ui/Alarms/AlarmModal.jsx';
import { NotifyProvider } from '/imports/ui/components/Notify/NotifyManager.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import { timeUntilPrecise } from '/imports/ui/utils/date.js';
import { CommandPalette } from '/imports/ui/CommandPalette/CommandPalette.jsx';
import { Onboarding } from '/imports/ui/Onboarding/Onboarding.jsx';
import { Preferences } from '/imports/ui/Preferences/Preferences.jsx';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import ChatWidget from '/imports/ui/components/ChatWidget/ChatWidget.jsx';
import { CalendarPage } from '/imports/ui/Calendar/CalendarPage.jsx';
import { PanoramaPage } from '/imports/ui/Panorama/PanoramaPage.jsx';
import { NotesPage } from '/imports/ui/Notes/NotesPage.jsx';
// HelpBubble removed
import UserLog from '/imports/ui/UserLog/UserLog.jsx';
import { playBeep } from '/imports/ui/utils/sound.js';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';

const SortableChip = ({ id, name, onOpen, active }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const fullName = name || '(untitled project)';
  const label = fullName.length > 10 ? `${fullName.slice(0, 10)}` : fullName;
  return (
    <a
      ref={setNodeRef}
      style={style}
      className={`favChip${isDragging ? ' dragging' : ''}${active ? ' active' : ''}`}
      href={`#/projects/${id}`}
      onClick={(e) => { e.preventDefault(); onOpen(); }}
      {...attributes}
      {...listeners}
    >
      <span className="star">★</span>
      <Tooltip content={fullName} placement="top">
        <span className="name">{label}</span>
      </Tooltip>
    </a>
  );
};
SortableChip.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string,
  onOpen: PropTypes.func.isRequired,
  active: PropTypes.bool,
};

function App() {
  const [route, setRoute] = useState(parseHashRoute());
  useAlarmScheduler();
  // Play a short beep at app startup
  useEffect(() => { playBeep(0.4); }, []);
  const ready = useTracker(() => Meteor.subscribe('alarms.mine').ready(), []);
  const alarms = useTracker(() => AlarmsCollection.find({}, { sort: { nextTriggerAt: 1 } }).fetch(), [ready]);
  const [activeAlarmId, setActiveAlarmId] = useState(null);
  // Provider will register notify handler; nothing to do here
  const [exportOpen, setExportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cmdDefaultTab, setCmdDefaultTab] = useState(0);
  const [cmdDefaultProjectId, setCmdDefaultProjectId] = useState('');
  const [qdrantModalOpen, setQdrantModalOpen] = useState(false);
  const [qdrantStatus, setQdrantStatus] = useState(null);
  // Command palette state is internal to component; keep only open/close here
  // Go to screen palette
  const [goOpen, setGoOpen] = useState(false);
  const goItems = [
    { key: 'v', label: 'Panorama', route: { name: 'panorama' } },
    { key: 'o', label: 'Overview', route: { name: 'dashboard' } },
    { key: 'j', label: 'Journal', route: { name: 'userlog' } },
    { key: 'e', label: 'Eisenhower', route: { name: 'eisenhower' } },
    { key: 'b', label: 'Budget', route: { name: 'budget' } },
    { key: 'r', label: 'Reporting', route: { name: 'reporting' } },
    { key: 'c', label: 'Calendar', route: { name: 'calendar' } },
    { key: 'p', label: 'People', route: { name: 'people' } },
    { key: 'f', label: 'Files', route: { name: 'files' } },
    { key: 'l', label: 'Links', route: { name: 'links' } },
    { key: 'a', label: 'Alarms', route: { name: 'alarms' } },
    { key: 's', label: 'Situation Analyzer', route: { name: 'situationAnalyzer' } },
    { key: 'i', label: 'Import tasks', route: { name: 'importTasks' } },
    { key: 't', label: 'Notes', route: { name: 'notes' } },
    { key: 'n', label: 'New Note Session', action: 'newSession' },
    { key: 'h', label: 'Help', route: { name: 'help' } },
    { key: 'g', label: 'Preferences', route: { name: 'preferences' } },
  ];
  const [goActiveIdx, setGoActiveIdx] = useState(0);
  // (removed local search states)
  const suppressRef = useRef(new Set());

  // Preferences
  const subPrefs = useSubscribe('appPreferences');
  const appPrefs = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];

  const suppressModalFor = (alarmId, ms = 3000) => {
    if (!alarmId) return;
    suppressRef.current.add(alarmId);
    setTimeout(() => {
      suppressRef.current.delete(alarmId);
    }, ms);
  };
  useEffect(() => {
    const now = Date.now();
    const effectiveTime = (a) => (a.snoozedUntilAt ? new Date(a.snoozedUntilAt).getTime() : new Date(a.nextTriggerAt).getTime());
    const firedPending = alarms.find(a => !suppressRef.current.has(a._id) && !a.enabled && !a.acknowledgedAt && (a.done || ((a.nextTriggerAt || a.snoozedUntilAt) && effectiveTime(a) <= now)));
    if (firedPending) {
      notify({ message: `Alarm: ${firedPending.title || 'Reminder'}`, kind: 'warning' });
      setActiveAlarmId(firedPending._id);
      return;
    }
    const due = alarms.find(a => !suppressRef.current.has(a._id) && a.enabled && (a.nextTriggerAt || a.snoozedUntilAt) && effectiveTime(a) <= now);
    if (due) {
      const id = due._id;
      const nextFields = { snoozedUntilAt: null, lastFiredAt: new Date(), enabled: false, done: true, acknowledgedAt: null };
      Meteor.call('alarms.update', id, nextFields, () => {
        notify({ message: `Alarm: ${due.title || 'Reminder'}`, kind: 'warning' });
        setActiveAlarmId(id);
      });
    }
  }, [JSON.stringify(alarms)]);

  useEffect(() => {
    const onKey = (e) => {
      if (!activeAlarmId) return;
      if (e.key === '1') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 5, () => notify({ message: 'Alarm snoozed +5m', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === '2') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 15, () => notify({ message: 'Alarm snoozed +15m', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === '3') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 60, () => notify({ message: 'Alarm snoozed +1h', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === 'Escape') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.dismiss', activeAlarmId, () => notify({ message: 'Alarm dismissed', kind: 'info' }));
        setActiveAlarmId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeAlarmId]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (hasMod && key === 'k') {
        e.preventDefault();
        setCmdDefaultTab(undefined);
        setCmdDefaultProjectId(route?.name === 'project' ? (route?.projectId || '') : '');
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [route?.name, route?.projectId]);

  // Global shortcut: Cmd/Ctrl + G → open Go to screen palette
  useEffect(() => {
    const onOpenGo = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || key !== 'g') return;
      e.preventDefault();
      setGoOpen(true);
      setGoActiveIdx(0);
    };
    window.addEventListener('keydown', onOpenGo);
    return () => window.removeEventListener('keydown', onOpenGo);
  }, []);

  // Tab cycling and autofocus now handled inside CommandPalette

  // (moved project Tab cycling effect below after 'order' is declared)

  // Global shortcut: Cmd/Ctrl + J → open UserLog page
  useEffect(() => {
    const onOpenUserLog = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || key !== 'j') return;
      e.preventDefault();
      navigateTo({ name: 'userlog' });
    };
    window.addEventListener('keydown', onOpenUserLog);
    return () => window.removeEventListener('keydown', onOpenUserLog);
  }, []);

  // Global shortcut: Cmd/Ctrl + E → open Eisenhower page
  useEffect(() => {
    const onOpenEisenhower = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || key !== 'e') return;
      e.preventDefault();
      navigateTo({ name: 'eisenhower' });
    };
    window.addEventListener('keydown', onOpenEisenhower);
    return () => window.removeEventListener('keydown', onOpenEisenhower);
  }, []);

  // Global shortcut: Cmd/Ctrl + N → create new Note Session (linked if on a project page)
  useEffect(() => {
    const onNewSessionShortcut = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || key !== 'n') return;
      e.preventDefault();
      handleNewSession(route?.name === 'project' ? route.projectId : undefined);
    };
    window.addEventListener('keydown', onNewSessionShortcut);
    return () => window.removeEventListener('keydown', onNewSessionShortcut);
  }, [route?.name, route?.projectId]);

  // Qdrant health check on startup
  useEffect(() => {
    const checkQdrant = () => {
      Meteor.call('qdrant.health', (err, res) => {
        if (err || !res || res.error || !res.exists) {
          const message = err?.reason || err?.message || res?.error || 'Qdrant indisponible';
          setQdrantStatus({ ok: false, error: message, info: res || null });
          setQdrantModalOpen(true);
          notify({ message: 'Qdrant indisponible — la recherche sémantique ne fonctionnera pas', kind: 'warning' });
        } else {
          setQdrantStatus({ ok: true, info: res });
        }
      });
    };
    checkQdrant();
  }, []);

  // Global navigation shortcuts: Back/Forward with Cmd/Ctrl + Left/Right
  useEffect(() => {
    const onNavKeys = (e) => {
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      const isEditable = target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
      if (isEditable) return;

      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window.history.back();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        window.history.forward();
      }
    };
    window.addEventListener('keydown', onNavKeys);
    return () => window.removeEventListener('keydown', onNavKeys);
  }, []);

  // Global shortcut: Cmd/Ctrl + I → cycle focus across visible inputs/textareas (no selects)
  useEffect(() => {
    const onCycleInputs = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || key !== 'i') return;

      e.preventDefault();
      const disallowedTypes = new Set(['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file']);
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const candidates = Array.from(document.querySelectorAll('input, textarea')).filter((el) => {
        if (!el || typeof el !== 'object') return false;
        if (el.getAttribute && el.getAttribute('tabindex') === '-1') return false;
        if (el.disabled) return false;
        const tag = String(el.tagName || '').toLowerCase();
        if (tag === 'textarea') return isVisible(el);
        if (tag !== 'input') return false; // explicitly exclude selects and others
        const type = String(el.type || 'text').toLowerCase();
        if (disallowedTypes.has(type)) return false;
        return isVisible(el);
      });
      if (candidates.length === 0) return;

      const activeEl = document.activeElement;
      const currentIdx = candidates.findIndex((el) => el === activeEl);
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % candidates.length : 0;
      const next = candidates[nextIdx];
      if (next && typeof next.focus === 'function') next.focus();
    };
    window.addEventListener('keydown', onCycleInputs);
    return () => window.removeEventListener('keydown', onCycleInputs);
  }, []);

  // Keyboard handling when Go to screen palette is open
  useEffect(() => {
    if (!goOpen) return;
    const performGoItem = (item) => {
      if (!item) return;
      if (item.action === 'newSession') {
        handleNewSession(route?.name === 'project' ? route.projectId : undefined);
        return;
      }
      if (item.route) {
        navigateTo(item.route);
      }
    };
    const onGoKeys = (e) => {
      // Only handle keys when Go to screen is open and not in an input field
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      const isEditable = target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
      if (isEditable) return;

      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      
      // Prevent global shortcuts when Go to screen is open
      if (hasMod) {
        e.preventDefault();
        return;
      }
      
      if (key === 'escape') { 
        e.preventDefault(); 
        setGoOpen(false); 
        return; 
      }
      if (key === 'arrowdown') { 
        e.preventDefault(); 
        setGoActiveIdx((i) => (i + 1) % goItems.length); 
        return; 
      }
      if (key === 'arrowup') { 
        e.preventDefault(); 
        setGoActiveIdx((i) => (i - 1 + goItems.length) % goItems.length); 
        return; 
      }
      if (key === 'enter') {
        e.preventDefault();
        const item = goItems[goActiveIdx];
        if (item) { performGoItem(item); setGoOpen(false); }
        return;
      }
      const hit = goItems.find(it => it.key === key);
      if (hit) { 
        e.preventDefault(); 
        performGoItem(hit); 
        setGoOpen(false); 
      }
    };
    window.addEventListener('keydown', onGoKeys);
    return () => window.removeEventListener('keydown', onGoKeys);
  }, [goOpen, goActiveIdx, route?.name, route?.projectId]);

  // Search logic moved to CommandPalette

  const goHome = () => navigateTo({ name: 'home' });
  const openProject = (projectId) => navigateTo({ name: 'project', projectId });
  const openSession = (sessionId) => navigateTo({ name: 'session', sessionId });
  const goImportTasks = () => navigateTo({ name: 'importTasks' });
  const goAlarms = () => navigateTo({ name: 'alarms' });
  // Qdrant route shortcut removed (unused)
  const goEisenhower = () => navigateTo({ name: 'eisenhower' });
  const goBudget = () => navigateTo({ name: 'budget' });
  const goReporting = () => navigateTo({ name: 'reporting' });
  const goCalendar = () => navigateTo({ name: 'calendar' });
  const goSituationAnalyzer = () => navigateTo({ name: 'situationAnalyzer' });
  const goPeople = () => navigateTo({ name: 'people' });
  const goFiles = () => navigateTo({ name: 'files' });
  const goUserLog = () => navigateTo({ name: 'userlog' });
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const favoriteProjects = useTracker(() => ProjectsCollection.find({ isFavorite: true }, { sort: { favoriteRank: 1, updatedAt: -1 }, fields: { name: 1, favoriteRank: 1 } }).fetch(), [projectsReady]);
  // allProjects removed from App-level (handled in CreateTaskPane)
  const [order, setOrder] = useState([]);
  useEffect(() => { setOrder(favoriteProjects.map(p => p._id)); }, [JSON.stringify(favoriteProjects.map(p => p._id))]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }));

  // hoisted SortableChip above

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    next.forEach((id, idx) => { Meteor.call('projects.update', id, { favoriteRank: idx }); });
  };

  // Universal Tab navigation: Panorama -> Overview -> Projects -> Panorama
  // For non-main pages: Tab always goes to Panorama
  useEffect(() => {
    const onTabNavigation = (e) => {
      if (e.key !== 'Tab') return;
      const hasMod = e.metaKey || e.ctrlKey;
      if (hasMod) return; // don't hijack Cmd/Ctrl+Tab
      if (searchOpen) return; // let CommandPalette handle Tab when open
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      const isEditable = target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
      if (isEditable) return; // don't hijack Tab in forms

      // Pages principales avec navigation Tab complexe
      const mainPages = ['home', 'dashboard', 'project'];
      
      if (mainPages.includes(route?.name)) {
        // Navigation complexe pour les pages principales
        if (!Array.isArray(order) || order.length === 0) return;
        
        e.preventDefault();
        
        // Navigation order: Panorama -> Overview -> Project1 -> Project2 -> ... -> Panorama
        if (route?.name === 'home') {
          // From Panorama
          if (e.shiftKey) {
            // Shift+Tab: go to last project
            const lastId = order[order.length - 1];
            if (lastId) navigateTo({ name: 'project', projectId: lastId });
          } else {
            // Tab: go to Overview
            navigateTo({ name: 'dashboard' });
          }
        } else if (route?.name === 'dashboard') {
          // From Overview
          if (e.shiftKey) {
            // Shift+Tab: go to Panorama
            navigateTo({ name: 'home' });
          } else {
            // Tab: go to first project
            const firstId = order[0];
            if (firstId) navigateTo({ name: 'project', projectId: firstId });
          }
        } else if (route?.name === 'project') {
          // From a project
          const currentId = route?.projectId || '';
          const currentIdx = order.indexOf(currentId);
          
          if (e.shiftKey) {
            // Shift+Tab: go to previous item
            if (currentIdx === 0) {
              // First project -> go to Overview
              navigateTo({ name: 'dashboard' });
            } else if (currentIdx > 0) {
              // Go to previous project
              const prevId = order[currentIdx - 1];
              navigateTo({ name: 'project', projectId: prevId });
            } else {
              // Not in favorites -> go to Overview
              navigateTo({ name: 'dashboard' });
            }
          } else if (currentIdx === order.length - 1) {
            // Tab: Last project -> go to Panorama
            navigateTo({ name: 'home' });
          } else if (currentIdx >= 0) {
            // Tab: Go to next project
            const nextId = order[currentIdx + 1];
            navigateTo({ name: 'project', projectId: nextId });
          } else if (order[0]) {
            // Tab: Not in favorites -> go to first project
            navigateTo({ name: 'project', projectId: order[0] });
          }
        }
      } else {
        // Pour toutes les autres pages : Tab -> Panorama
        e.preventDefault();
        // Tab et Shift+Tab vont tous les deux à Panorama
        navigateTo({ name: 'home' });
      }
    };
    
    window.addEventListener('keydown', onTabNavigation);
    return () => window.removeEventListener('keydown', onTabNavigation);
  }, [route?.name, route?.projectId, searchOpen, JSON.stringify(order)]);

  // Global: Cmd/Ctrl + Shift + H → go to Overview
  useEffect(() => {
    const onGoOverview = (e) => {
      const key = String(e.key || '').toLowerCase();
      const hasMod = e.metaKey || e.ctrlKey;
      if (!hasMod || !e.shiftKey || key !== 'h') return;
      e.preventDefault();
      navigateTo({ name: 'dashboard' });
    };
    window.addEventListener('keydown', onGoOverview);
    return () => window.removeEventListener('keydown', onGoOverview);
  }, []);

  const handleNewProject = () => {
    Meteor.call('projects.insert', { name: 'New Project', status: 'active' }, (err, res) => {
      if (err) {
        console.error('projects.insert failed', err);
        return;
      }
      if (res) openProject(res);
    });
  };

  const handleNewSession = (projectId) => {
    Meteor.call('noteSessions.insert', { projectId }, (err, res) => {
      if (err) {
        console.error('noteSessions.insert failed', err);
        return;
      }
      if (res) openSession(res);
    });
  };

  // create task now handled inside CommandPalette

  const [wide, setWide] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('container_wide') === '1';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('container_wide', wide ? '1' : '0');
  }, [wide]);

  // Redirect to onboarding if not configured
  useEffect(() => {
    if (subPrefs()) return; // not ready
    const needsOnboarding = !appPrefs || !appPrefs.onboardedAt || !appPrefs.filesDir;
    if (needsOnboarding && route?.name !== 'onboarding') {
      navigateTo({ name: 'onboarding' });
    }
  }, [subPrefs(), appPrefs?._id, route?.name]);

  return (
    <div className={`container${wide ? ' w90' : ''}`}>
      <h1><a href="#/" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'home' }); }}>Panorama</a></h1>
      {favoriteProjects.length > 0 && (
        <div className="favoritesBar">
          <a className={`favChip${route?.name === 'home' ? ' active' : ''}`} href="#/" onClick={(e) => { e.preventDefault(); goHome(); }}>
            <span className="name">Panorama</span>
          </a>
          <a className={`favChip${route?.name === 'dashboard' ? ' active' : ''}`} href="#/dashboard" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'dashboard' }); }}>
            <span className="name">Overview</span>
          </a>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={horizontalListSortingStrategy}>
              {order.map((id) => {
                const fp = favoriteProjects.find((p) => p._id === id);
                if (!fp) return null;
                return (
                  <SortableChip
                    key={id}
                    id={id}
                    name={fp?.name}
                    onOpen={() => openProject(id)}
                    active={route?.name === 'project' && route?.projectId === id}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}
      {route?.name === 'home' && (
        <div className="panel">
          <div className="homeToolbar">
            <button className="btn btn-primary" onClick={handleNewProject}>New Project</button>
            <button className="btn ml8" onClick={() => handleNewSession(undefined)}>New Note Session</button>
          </div>
          <PanoramaPage />
        </div>
      )}
      {route?.name === 'dashboard' && (
        <div className="panel">
          <div className="homeToolbar">
            <button className="btn btn-primary" onClick={handleNewProject}>New Project</button>
            <button className="btn ml8" onClick={() => handleNewSession(undefined)}>New Note Session</button>
          </div>
          <Dashboard />
        </div>
      )}
      {route?.name === 'project' && (
        <div className="panel">
          <ProjectDetails
            key={route.projectId}
            projectId={route.projectId}
            onBack={goHome}
            onOpenNoteSession={handleNewSession}
            onCreateTaskViaPalette={(pid) => {
              setCmdDefaultTab(1);
              setCmdDefaultProjectId(pid || route.projectId || '');
              setSearchOpen(true);
            }}
          />
        </div>
      )}
      {route?.name === 'session' && (
        <div className="panel">
          <NoteSession sessionId={route.sessionId} onBack={goHome} />
        </div>
      )}
      {route?.name === 'projectDelete' && (
        <div className="panel">
          <ProjectDelete
            projectId={route.projectId}
            onBack={() => navigateTo({ name: 'project', projectId: route.projectId })}
          />
        </div>
      )}
      {route?.name === 'help' && (
        <div className="panel">
          <Help />
        </div>
      )}
      {route?.name === 'alarms' && (
        <div className="panel">
          <Alarms />
        </div>
      )}
      {route?.name === 'eisenhower' && (
        <div className="panel">
          <Eisenhower />
        </div>
      )}
      {route?.name === 'budget' && (
        <div className="panel">
          <BudgetPage />
        </div>
      )}
      {route?.name === 'reporting' && (
        <div className="panel">
          <ReportingPage />
        </div>
      )}
      {route?.name === 'calendar' && (
        <div className="panel">
          <CalendarPage />
        </div>
      )}
      {route?.name === 'panorama' && (
        <div className="panel">
          <PanoramaPage />
        </div>
      )}
      {route?.name === 'situationAnalyzer' && (
        <div className="panel">
          <SituationAnalyzer />
        </div>
      )}
      {route?.name === 'people' && (
        <div className="panel">
          <PeoplePage highlightId={route.personId} />
        </div>
      )}
      {route?.name === 'links' && (
        <div className="panel">
          <LinksPage />
        </div>
      )}
      {route?.name === 'files' && (
        <div className="panel">
          <FilesPage />
        </div>
      )}
      {route?.name === 'userlog' && (
        <div className="panel">
          <UserLog />
        </div>
      )}
      {route?.name === 'notes' && (
        <div className="panel">
          <NotesPage />
        </div>
      )}
      {route?.name === 'onboarding' && (
        <div className="panel">
          <Onboarding />
        </div>
      )}
      {route?.name === 'preferences' && (
        <div className="panel">
          <Preferences />
        </div>
      )}
      {route?.name === 'importTasks' && (
        <div className="panel">
          <ImportTasks />
        </div>
      )}
      <AlarmModal
        open={!!activeAlarmId}
        alarm={activeAlarmId ? alarms.find(a => a._id === activeAlarmId) : null}
        onClose={() => setActiveAlarmId(null)}
        onBeforeAction={(id) => suppressModalFor(id)}
      />
      <Modal
        open={goOpen}
        onClose={() => setGoOpen(false)}
        title="Go to screen"
        actions={[
          <button key="close" className="btn" onClick={() => setGoOpen(false)}>Close</button>
        ]}
      >
        <ul className="goList">
          {goItems.map((it, idx) => (
            <li key={it.key}>
              <a
                href="#/"
                className={`goItem${idx === goActiveIdx ? ' active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (it.action === 'newSession') {
                    handleNewSession(route?.name === 'project' ? route.projectId : undefined);
                  } else if (it.route) {
                    navigateTo(it.route);
                  }
                  setGoOpen(false);
                }}
              >
                <span className="goKey">{String(it.key || '').toUpperCase()}</span>
                <span className="goLabel">{it.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="muted">Tip: ⌘G / Ctrl+G · ↑/↓ to navigate · Enter or type the letter</p>
      </Modal>
      {/* Notification provider renders stacked toasts globally */}
      <NotifyProvider />
      <Modal
        open={qdrantModalOpen}
        onClose={() => setQdrantModalOpen(false)}
        title="Qdrant indisponible"
        icon={<span aria-hidden="true">⚠️</span>}
        actions={[
          <button key="retry" className="btn" onClick={() => {
            Meteor.call('qdrant.health', (err, res) => {
              if (err || !res || res.error || !res.exists) {
                const message = err?.reason || err?.message || res?.error || 'Toujours indisponible';
                setQdrantStatus({ ok: false, error: message, info: res || null });
                notify({ message: 'Qdrant toujours indisponible', kind: 'error' });
                return;
              }
              setQdrantStatus({ ok: true, info: res });
              notify({ message: 'Qdrant est de nouveau disponible', kind: 'success' });
              setQdrantModalOpen(false);
            });
          }}>Réessayer</button>,
          <button key="prefs" className="btn ml8" onClick={() => { setQdrantModalOpen(false); navigateTo({ name: 'preferences' }); }}>Ouvrir Préférences</button>,
          <button key="close" className="btn ml8" onClick={() => setQdrantModalOpen(false)}>Ignorer</button>
        ]}
      >
        <div>
          <p>La base Qdrant n'est pas accessible. La recherche sémantique sera désactivée tant que la connexion n'est pas rétablie.</p>
          {qdrantStatus?.error ? (
            <p className="muted">Détails: {String(qdrantStatus.error)}</p>
          ) : null}
          {qdrantStatus?.info?.url ? (
            <p className="muted">URL configurée: {qdrantStatus.info.url}</p>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export data"
        actions={[
          <button key="close" className="btn" onClick={() => setExportOpen(false)}>Close</button>
        ]}
      >
        <div className="exportModalBody">
          <p>Select an export format:</p>
          <ul>
            <li><strong>Export JSON</strong> 📄: for small databases; single JSON generated in memory and downloaded through DDP.</li>
            <li><strong>Export Archive</strong> 📦: for large databases; server generates a compressed NDJSON archive and you download it via HTTP.</li>
          </ul>
          <div className="exportModalButtons">
            <button className="btn" onClick={() => {
              Meteor.call('app.exportAll', (err, data) => {
                if (err) { console.error('export failed', err); notify({ message: `Export failed: ${err?.reason || err?.message || 'Unknown error'}` , kind: 'error' }); return; }
                try {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `panorama-export-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  notify({ message: 'Export downloaded', kind: 'success' });
                } catch (e) {
                  console.error('export save failed', e);
                  notify({ message: 'Export failed', kind: 'error' });
                }
              });
            }}>
              📄 Export JSON
            </button>
            <button className="btn" onClick={() => {
              const handleStatus = (jobId) => {
                const poll = () => {
                  Meteor.call('app.exportArchiveStatus', jobId, (e2, st) => {
                    if (e2 || !st || !st.exists) { notify({ message: 'Archive failed', kind: 'error' }); return; }
                    if (st.error) { notify({ message: `Archive failed: ${st.error?.message || 'Unknown error'}`, kind: 'error' }); return; }
                    if (!st.ready) { setTimeout(poll, 800); return; }
                    setExportOpen(false);
                    const link = `/download-export/${jobId}`;
                    const a = document.createElement('a');
                    a.href = link;
                    a.download = `panorama-export-${jobId}.ndjson.gz`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    notify({ message: 'Archive download started', kind: 'success' });
                  });
                };
                poll();
              };
              Meteor.call('app.exportArchiveStart', (err, res) => {
                if (err || !res) { notify({ message: 'Archive start failed', kind: 'error' }); return; }
                handleStatus(res.jobId);
              });
            }}>
              📦 Export Archive
            </button>
          </div>
        </div>
      </Modal>
      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        defaultTab={cmdDefaultTab}
        defaultProjectId={cmdDefaultProjectId}
      />
      <footer className="appFooter">
        <span>Panorama — get a clear view of your projects</span>
        <span className="footerNextAlarm">
          {(() => {
            const effective = (a) => (a.snoozedUntilAt ? new Date(a.snoozedUntilAt) : new Date(a.nextTriggerAt));
            const next = alarms
              .filter(a => a.enabled && (a.snoozedUntilAt || a.nextTriggerAt))
              .sort((a, b) => effective(a).getTime() - effective(b).getTime())[0];
            return next ? `Next alarm: ${timeUntilPrecise(effective(next))}` : '';
          })()}
        </span>
        <span>
          <a href="#/help">Help</a>
          <span className="dot">·</span>
          <a href="#/alarms" onClick={(e) => { e.preventDefault(); goAlarms(); }}>Alarms</a>
          <span className="dot">·</span>
          <a href="#/import-tasks" onClick={(e) => { e.preventDefault(); goImportTasks(); }}>Import tasks</a>
          <span className="dot">·</span>
          
          <a href="#/eisenhower" onClick={(e) => { e.preventDefault(); goEisenhower(); }}>Eisenhower</a>
          <span className="dot">·</span>
          <a href="#/budget" onClick={(e) => { e.preventDefault(); goBudget(); }}>Budget</a>
          <span className="dot">·</span>
          <a href="#/reporting" onClick={(e) => { e.preventDefault(); goReporting(); }}>Reporting</a>
          <span className="dot">·</span>
          <a href="#/calendar" onClick={(e) => { e.preventDefault(); goCalendar(); }}>Calendar</a>
          <span className="dot">·</span>
          <a href="#/situation-analyzer" onClick={(e) => { e.preventDefault(); goSituationAnalyzer(); }}>Situation Analyzer</a>
          <span className="dot">·</span>
          <a href="#/people" onClick={(e) => { e.preventDefault(); goPeople(); }}>People</a>
          <span className="dot">·</span>
          <a href="#/export" onClick={(e) => { e.preventDefault(); setExportOpen(true); }}>Export</a>
          <span className="dot">·</span>
          <a href="#/links" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'links' }); }}>Links</a>
          <span className="dot">·</span>
          <a href="#/files" onClick={(e) => { e.preventDefault(); goFiles(); }}>Files</a>
          <span className="dot">·</span>
          <a href="#/preferences" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'preferences' }); }}>Preferences</a>
          <span className="dot">·</span>
          <a href="#/userlog" onClick={(e) => { e.preventDefault(); goUserLog(); }}>Journal</a>
          <span className="dot">·</span>
          <a href="#/width" onClick={(e) => { e.preventDefault(); setWide(v => !v); }}>{wide ? 'Width: 90%' : 'Width: 1100px'}</a>
        </span>
      </footer>
      <ChatWidget />
    </div>
  );
}

export default App;
