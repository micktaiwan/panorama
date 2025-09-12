import React, { useEffect, useRef, useState } from 'react';
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
import { useTracker } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Notify } from '/imports/ui/components/Notify/Notify.jsx';
import { setNotifyHandler } from '/imports/ui/utils/notify.js';
import { formatDateTime, timeUntilPrecise } from '/imports/ui/utils/date.js';
import { SearchBar } from '/imports/ui/components/Search/SearchBar.jsx';
import { SearchResults } from '/imports/ui/components/Search/SearchResults.jsx';
import { SearchTypeFilters } from '/imports/ui/components/Search/SearchTypeFilters.jsx';
import { Onboarding } from '/imports/ui/Onboarding/Onboarding.jsx';
import { Preferences } from '/imports/ui/Preferences/Preferences.jsx';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import ChatWidget from '/imports/ui/components/ChatWidget/ChatWidget.jsx';
// HelpBubble removed
import UserLog from '/imports/ui/UserLog/UserLog.jsx';
import { playBeep } from '/imports/ui/utils/sound.js';

function App() {
  const [route, setRoute] = useState(parseHashRoute());
  useAlarmScheduler();
  // Play a short beep at app startup
  useEffect(() => { playBeep(0.4); }, []);
  const ready = useTracker(() => Meteor.subscribe('alarms.mine').ready(), []);
  const alarms = useTracker(() => AlarmsCollection.find({}, { sort: { nextTriggerAt: 1 } }).fetch(), [ready]);
  const [activeAlarmId, setActiveAlarmId] = useState(null);
  const [toast, setToast] = useState(null);
  // Wire global notify to page-level toast
  useEffect(() => {
    setNotifyHandler((t) => setToast(t));
    return () => setNotifyHandler(null);
  }, []);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [qdrantModalOpen, setQdrantModalOpen] = useState(false);
  const [qdrantStatus, setQdrantStatus] = useState(null);
  const [searchQ, setSearchQ] = useState(() => {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem('global_search_q') || '') : '';
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searchFiltered, setSearchFiltered] = useState([]);
  const [searchCached, setSearchCached] = useState(false);
  const [searchCacheSize, setSearchCacheSize] = useState(0);
  const [searchLastKey, setSearchLastKey] = useState('');
  const [searchDirty, setSearchDirty] = useState(false);
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [typeFilters, setTypeFilters] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('search_type_filters_v1');
      if (raw) { try { return JSON.parse(raw) || {}; } catch (_e) {} }
    }
    return {};
  });
  const [typeCounts, setTypeCounts] = useState({});
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
      const isPomo = (firedPending.title || '').toLowerCase() === 'pomodoro';
      setToast({ message: `Alarm: ${firedPending.title || 'Reminder'}`, kind: 'warning' });
      if (isPomo) {
        Meteor.call('alarms.remove', firedPending._id, () => {});
      } else {
        setActiveAlarmId(firedPending._id);
      }
      return;
    }
    const due = alarms.find(a => !suppressRef.current.has(a._id) && a.enabled && (a.nextTriggerAt || a.snoozedUntilAt) && effectiveTime(a) <= now);
    if (due) {
      const id = due._id;
      const nextFields = { snoozedUntilAt: null, lastFiredAt: new Date(), enabled: false, done: true, acknowledgedAt: null };
      Meteor.call('alarms.update', id, nextFields, () => {
        const isPomo = (due.title || '').toLowerCase() === 'pomodoro';
        setToast({ message: `Alarm: ${due.title || 'Reminder'}`, kind: 'warning' });
        if (isPomo) {
          Meteor.call('alarms.remove', id, () => {});
        } else {
          setActiveAlarmId(id);
        }
      });
    }
  }, [JSON.stringify(alarms)]);

  useEffect(() => {
    const onKey = (e) => {
      if (!activeAlarmId) return;
      if (e.key === '1') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 5, () => setToast({ message: 'Alarm snoozed +5m', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === '2') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 15, () => setToast({ message: 'Alarm snoozed +15m', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === '3') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.snooze', activeAlarmId, 60, () => setToast({ message: 'Alarm snoozed +1h', kind: 'success' }));
        setActiveAlarmId(null);
      } else if (e.key === 'Escape') {
        suppressModalFor(activeAlarmId);
        Meteor.call('alarms.dismiss', activeAlarmId, () => setToast({ message: 'Alarm dismissed', kind: 'info' }));
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
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // Qdrant health check on startup
  useEffect(() => {
    const checkQdrant = () => {
      Meteor.call('qdrant.health', (err, res) => {
        if (err || !res || res.error || !res.exists) {
          const message = err?.reason || err?.message || res?.error || 'Qdrant indisponible';
          setQdrantStatus({ ok: false, error: message, info: res || null });
          setQdrantModalOpen(true);
          setToast({ message: 'Qdrant indisponible — la recherche sémantique ne fonctionnera pas', kind: 'warning' });
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

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('global_search_q', searchQ || '');
  }, [searchQ]);

  const runSearch = (query) => {
    setSearchLoading(true);
    if (!String(query).trim()) { setSearchResults([]); setSearchLoading(false); return; }
    Meteor.call('panorama.search', query, (err, res) => {
      setSearchLoading(false);
      if (err) { console.error('panorama.search failed', err); setSearchResults([]); return; }
      const items = Array.isArray(res) ? res : (res?.results || []);
      setSearchResults(items);
      setSearchCached(!!res?.cachedVector);
      setSearchCacheSize(Number.isFinite(res?.cacheSize) ? res.cacheSize : 0);
      const normalize = (q) => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      setSearchLastKey(`v1|${normalize(query)}`);
      setSearchDirty(false);
    });
  };

  // Derive counts and filtered list whenever results or filters change
  useEffect(() => {
    const counts = { project: 0, task: 0, note: 0, link: 0, file: 0, session: 0 };
    for (const r of (searchResults || [])) {
      const k = r?.kind;
      if (k && Object.prototype.hasOwnProperty.call(counts, k)) counts[k] += 1;
    }
    setTypeCounts(counts);

    const hasInclude = Object.values(typeFilters).some(v => v === 1);
    const filtered = (searchResults || []).filter(r => {
      const k = r?.kind;
      const st = typeFilters[k];
      if (hasInclude) return st === 1;
      return st === -1 ? false : true;
    });
    setSearchFiltered(filtered);
    // Reset active index if now out of range
    setSearchActiveIdx(idx => (idx >= 0 && idx < filtered.length ? idx : -1));
  }, [JSON.stringify(searchResults), JSON.stringify(typeFilters)]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('search_type_filters_v1', JSON.stringify(typeFilters)); } catch (_e) {}
    }
  }, [JSON.stringify(typeFilters)]);

  useEffect(() => {
    if (searchOpen && String(searchQ).trim() && searchResults.length === 0) {
      runSearch(searchQ);
    }
  }, [searchOpen]);

  const goHome = () => navigateTo({ name: 'home' });
  const openProject = (projectId) => navigateTo({ name: 'project', projectId });
  const openSession = (sessionId) => navigateTo({ name: 'session', sessionId });
  const goImportTasks = () => navigateTo({ name: 'importTasks' });
  const goAlarms = () => navigateTo({ name: 'alarms' });
  const goQdrant = () => navigateTo({ name: 'qdrant' });
  const goEisenhower = () => navigateTo({ name: 'eisenhower' });
  const goBudget = () => navigateTo({ name: 'budget' });
  const goReporting = () => navigateTo({ name: 'reporting' });
  const goSituationAnalyzer = () => navigateTo({ name: 'situationAnalyzer' });
  const goPeople = () => navigateTo({ name: 'people' });
  const goFiles = () => navigateTo({ name: 'files' });
  const goUserLog = () => navigateTo({ name: 'userlog' });
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const favoriteProjects = useTracker(() => ProjectsCollection.find({ isFavorite: true }, { sort: { favoriteRank: 1, updatedAt: -1 }, fields: { name: 1, favoriteRank: 1 } }).fetch(), [projectsReady]);
  const [order, setOrder] = useState([]);
  useEffect(() => { setOrder(favoriteProjects.map(p => p._id)); }, [JSON.stringify(favoriteProjects.map(p => p._id))]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }));

  const SortableChip = ({ id, name, onOpen }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    return (
      <a
        ref={setNodeRef}
        style={style}
        className={`favChip${isDragging ? ' dragging' : ''}`}
        href={`#/projects/${id}`}
        onClick={(e) => { e.preventDefault(); onOpen(); }}
        {...attributes}
        {...listeners}
      >
        <span className="star">★</span>
        <span className="name">{name || '(untitled project)'}</span>
      </a>
    );
  };

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    next.forEach((id, idx) => { Meteor.call('projects.update', id, { favoriteRank: idx }); });
  };

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
    if (needsOnboarding && route.name !== 'onboarding') {
      navigateTo({ name: 'onboarding' });
    }
  }, [subPrefs(), appPrefs && appPrefs._id, route && route.name]);

  return (
    <div className={`container${wide ? ' w90' : ''}`}>
      <h1><a href="#/" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'home' }); }}>Panorama</a></h1>
      {favoriteProjects.length > 0 && (
        <div className="favoritesBar">
          <a className="favChip" href="#/" onClick={(e) => { e.preventDefault(); goHome(); }}>
            <span className="name">Dashboard</span>
          </a>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={horizontalListSortingStrategy}>
              {order.map(id => {
                const fp = favoriteProjects.find(p => p._id === id);
                if (!fp) return null;
                return <SortableChip key={id} id={id} name={fp.name} onOpen={() => openProject(id)} />;
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}
      {route.name === 'home' && (
        <div className="panel">
          <div className="homeToolbar">
            <button className="btn btn-primary" onClick={handleNewProject}>New Project</button>
            <button className="btn ml8" onClick={() => handleNewSession(undefined)}>New Note Session</button>
          </div>
          <Dashboard />
        </div>
      )}
      {route.name === 'project' && (
        <div className="panel">
          <ProjectDetails
            key={route.projectId}
            projectId={route.projectId}
            onBack={goHome}
            onOpenNoteSession={handleNewSession}
          />
        </div>
      )}
      {route.name === 'session' && (
        <div className="panel">
          <NoteSession sessionId={route.sessionId} onBack={goHome} />
        </div>
      )}
      {route.name === 'projectDelete' && (
        <div className="panel">
          <ProjectDelete
            projectId={route.projectId}
            onBack={() => navigateTo({ name: 'project', projectId: route.projectId })}
          />
        </div>
      )}
      {route.name === 'help' && (
        <div className="panel">
          <Help />
        </div>
      )}
      {route.name === 'alarms' && (
        <div className="panel">
          <Alarms />
        </div>
      )}
      {route.name === 'eisenhower' && (
        <div className="panel">
          <Eisenhower />
        </div>
      )}
      {route.name === 'budget' && (
        <div className="panel">
          <BudgetPage />
        </div>
      )}
      {route.name === 'reporting' && (
        <div className="panel">
          <ReportingPage />
        </div>
      )}
      {route.name === 'situationAnalyzer' && (
        <div className="panel">
          <SituationAnalyzer />
        </div>
      )}
      {route.name === 'people' && (
        <div className="panel">
          <PeoplePage highlightId={route.personId} />
        </div>
      )}
      {route.name === 'links' && (
        <div className="panel">
          <LinksPage />
        </div>
      )}
      {route.name === 'files' && (
        <div className="panel">
          <FilesPage />
        </div>
      )}
      {route.name === 'userlog' && (
        <div className="panel">
          <UserLog />
        </div>
      )}
      {route.name === 'onboarding' && (
        <div className="panel">
          <Onboarding />
        </div>
      )}
      {route.name === 'preferences' && (
        <div className="panel">
          <Preferences />
        </div>
      )}
      {route.name === 'importTasks' && (
        <div className="panel">
          <ImportTasks />
        </div>
      )}
      <Modal
        open={!!activeAlarmId}
        onClose={() => setActiveAlarmId(null)}
        title={activeAlarmId ? `${alarms.find(a => a._id === activeAlarmId)?.title || ''}` : 'Alarm'}
        icon={<span role="img" aria-label="bell">🔔</span>}
        actions={[
          <button key="s5" className="btn" onClick={() => { if (activeAlarmId) { suppressModalFor(activeAlarmId); const until = new Date(Date.now() + 5 * 60000); Meteor.call('alarms.snooze', activeAlarmId, 5, (err) => { if (err) { setToast({ message: 'Snooze failed', kind: 'error' }); } else { setToast({ message: `Alarm snoozed until ${formatDateTime(until)}`, kind: 'success' }); } }); } setActiveAlarmId(null); }}>Snooze +5m</button>,
          <button key="s15" className="btn ml8" onClick={() => { if (activeAlarmId) { suppressModalFor(activeAlarmId); const until = new Date(Date.now() + 15 * 60000); Meteor.call('alarms.snooze', activeAlarmId, 15, (err) => { if (err) { setToast({ message: 'Snooze failed', kind: 'error' }); } else { setToast({ message: `Alarm snoozed until ${formatDateTime(until)}`, kind: 'success' }); } }); } setActiveAlarmId(null); }}>+15m</button>,
          <button key="s60" className="btn ml8" onClick={() => { if (activeAlarmId) { suppressModalFor(activeAlarmId); const until = new Date(Date.now() + 60 * 60000); Meteor.call('alarms.snooze', activeAlarmId, 60, (err) => { if (err) { setToast({ message: 'Snooze failed', kind: 'error' }); } else { setToast({ message: `Alarm snoozed until ${formatDateTime(until)}`, kind: 'success' }); } }); } setActiveAlarmId(null); }}>+1h</button>,
          <button key="dismiss" className="btn ml8" onClick={() => { if (activeAlarmId) { suppressModalFor(activeAlarmId); Meteor.call('alarms.dismiss', activeAlarmId, (err) => { if (err) { setToast({ message: 'Dismiss failed', kind: 'error' }); } else { setToast({ message: 'Alarm dismissed', kind: 'info' }); } }); } setActiveAlarmId(null); }}>Dismiss</button>
        ]}
      >
        {activeAlarmId ? (() => { const a = alarms.find(x => x._id === activeAlarmId); return a ? (
          a.snoozedUntilAt ? (
            <div>Now snoozed until: {new Date(a.snoozedUntilAt).toLocaleString()} — original: {new Date(a.nextTriggerAt).toLocaleString()}</div>
          ) : (
            <div>Scheduled: {new Date(a.nextTriggerAt).toLocaleString()}</div>
          )
        ) : null; })() : null}
      </Modal>
      {toast ? (
        <Notify message={toast.message} kind={toast.kind || 'info'} onClose={() => setToast(null)} durationMs={3000} />
      ) : null}
      <Modal
        open={qdrantModalOpen}
        onClose={() => setQdrantModalOpen(false)}
        title="Qdrant indisponible"
        icon={<span role="img" aria-label="warning">⚠️</span>}
        actions={[
          <button key="retry" className="btn" onClick={() => {
            Meteor.call('qdrant.health', (err, res) => {
              if (err || !res || res.error || !res.exists) {
                const message = err?.reason || err?.message || res?.error || 'Toujours indisponible';
                setQdrantStatus({ ok: false, error: message, info: res || null });
                setToast({ message: 'Qdrant toujours indisponible', kind: 'error' });
              } else {
                setQdrantStatus({ ok: true, info: res });
                setToast({ message: 'Qdrant est de nouveau disponible', kind: 'success' });
                setQdrantModalOpen(false);
              }
            });
          }}>Réessayer</button>,
          <button key="prefs" className="btn ml8" onClick={() => { setQdrantModalOpen(false); navigateTo({ name: 'preferences' }); }}>Ouvrir Préférences</button>,
          <button key="close" className="btn ml8" onClick={() => setQdrantModalOpen(false)}>Ignorer</button>
        ]}
      >
        <div>
          <p>La base Qdrant n'est pas accessible. La recherche sémantique sera désactivée tant que la connexion n'est pas rétablie.</p>
          {qdrantStatus && qdrantStatus.error ? (
            <p className="muted">Détails: {String(qdrantStatus.error)}</p>
          ) : null}
          {qdrantStatus && qdrantStatus.info && qdrantStatus.info.url ? (
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
                if (err) { console.error('export failed', err); setToast({ message: `Export failed: ${err?.reason || err?.message || 'Unknown error'}` , kind: 'error' }); return; }
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
                  setToast({ message: 'Export downloaded', kind: 'success' });
                } catch (e) {
                  console.error('export save failed', e);
                  setToast({ message: 'Export failed', kind: 'error' });
                }
              });
            }}>
              📄 Export JSON
            </button>
            <button className="btn" onClick={() => {
              Meteor.call('app.exportArchiveStart', (err, res) => {
                if (err || !res) { setToast({ message: 'Archive start failed', kind: 'error' }); return; }
                const { jobId } = res;
                const poll = () => {
                  Meteor.call('app.exportArchiveStatus', jobId, (e2, st) => {
                    if (e2 || !st || !st.exists) { setToast({ message: 'Archive failed', kind: 'error' }); return; }
                    if (st.error) { setToast({ message: `Archive failed: ${st.error?.message || 'Unknown error'}`, kind: 'error' }); return; }
                    if (!st.ready) { setTimeout(poll, 800); return; }
                    setExportOpen(false);
                    const link = `/download-export/${jobId}`;
                    const a = document.createElement('a');
                    a.href = link;
                    a.download = `panorama-export-${jobId}.ndjson.gz`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setToast({ message: 'Archive download started', kind: 'success' });
                  });
                };
                poll();
              });
            }}>
              📦 Export Archive
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Search"
        panelClassName="wide"
        actions={[
          <button key="close" className="btn" onClick={() => setSearchOpen(false)}>Close</button>
        ]}
      >
        <SearchBar
          value={searchQ}
          onChange={(v) => {
            setSearchQ(v);
            setSearchDirty(true);
            setSearchActiveIdx(-1);
          }}
          onSearch={(query) => {
            runSearch(query);
          }}
          resultsCount={searchResults.length}
          cached={searchCached}
          loading={searchLoading}
          cacheSize={searchCacheSize}
          autoFocus
          armSelectFirst={searchResults.length > 0 && !searchDirty}
          onSelectFirst={() => {
            if (searchResults.length > 0) {
              const idx = (typeof searchActiveIdx === 'number' && searchActiveIdx >= 0 && searchActiveIdx < searchResults.length) ? searchActiveIdx : 0;
              const r = searchResults[idx];
              // Minimal duplicate logic to avoid ref wiring
              if (r.kind === 'project' && r.id) {
                const id = String(r.id).split(':').pop();
                navigateTo({ name: 'project', projectId: id });
                setSearchOpen(false);
                return;
              }
              if (r.kind === 'task' && r.projectId) {
                navigateTo({ name: 'project', projectId: r.projectId });
                setSearchOpen(false);
                return;
              }
              if (r.kind === 'line' && r.sessionId) {
                navigateTo({ name: 'session', sessionId: r.sessionId });
                setSearchOpen(false);
                return;
              }
              if (r.kind === 'note' && r.projectId) {
                navigateTo({ name: 'project', projectId: r.projectId });
                setSearchOpen(false);
                return;
              }
              if (r.kind === 'session' && r.id) {
                const id = String(r.id).split(':').pop();
                navigateTo({ name: 'session', sessionId: id });
                setSearchOpen(false);
                return;
              }
              if (r.kind === 'alarm') {
                navigateTo({ name: 'alarms' });
                setSearchOpen(false);
                return;
              }
              navigateTo({ name: 'home' });
              setSearchOpen(false);
            }
          }}
        />
        <SearchTypeFilters
          value={typeFilters}
          onChange={setTypeFilters}
          counts={typeCounts}
        />
        <SearchResults
          results={searchFiltered}
          onAfterNavigate={(idx) => { setSearchActiveIdx(idx ?? -1); setSearchOpen(false); }}
          keyboardNav={true}
          activeIdx={searchActiveIdx}
          onActiveChange={setSearchActiveIdx}
          stale={searchDirty}
        />
        <p className="muted">Tip: ⌘K / Ctrl+K to open this anywhere.</p>
      </Modal>
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
          <a href="#/" onClick={(e) => { e.preventDefault(); goHome(); }}>Dashboard</a>
          <span className="dot">·</span>
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
