import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { SearchBar } from '/imports/ui/components/Search/SearchBar.jsx';
import { SearchResults } from '/imports/ui/components/Search/SearchResults.jsx';
import { SearchTypeFilters } from '/imports/ui/components/Search/SearchTypeFilters.jsx';
import { navigateTo } from '/imports/ui/router.js';
import { notify } from '/imports/ui/utils/notify.js';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import './CommandPalette.css';

const Tabs = ({ active, onChange }) => {
  return (
    <div className="cmdTabs" role="tablist" aria-label="Command palette tabs">
      <button
        className={`cmdTab${active === 0 ? ' active' : ''}`}
        role="tab"
        aria-selected={active === 0}
        onClick={() => onChange(0)}
      >Search</button>
      <button
        className={`cmdTab ml8${active === 1 ? ' active' : ''}`}
        role="tab"
        aria-selected={active === 1}
        onClick={() => onChange(1)}
      >Create Task</button>
      <button
        className={`cmdTab ml8${active === 2 ? ' active' : ''}`}
        role="tab"
        aria-selected={active === 2}
        onClick={() => onChange(2)}
      >Create Note</button>
      <button
        className={`cmdTab ml8${active === 3 ? ' active' : ''}`}
        role="tab"
        aria-selected={active === 3}
        onClick={() => onChange(3)}
      >Create Alarm</button>
      <span className="muted ml8">(Tab to switch)</span>
    </div>
  );
};
Tabs.propTypes = {
  active: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

const SearchPane = ({ onClose }) => {
  const [searchQ, setSearchQ] = useState(() => {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem('global_search_q') || '') : '';
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searchFiltered, setSearchFiltered] = useState([]);
  const [searchCached, setSearchCached] = useState(false);
  const [searchCacheSize, setSearchCacheSize] = useState(0);
  const [searchDirty, setSearchDirty] = useState(false);
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [typeFilters, setTypeFilters] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('search_type_filters_v1');
      if (raw) return JSON.parse(raw) || {};
    }
    return {};
  });
  const [typeCounts, setTypeCounts] = useState({});

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('search_type_filters_v1', JSON.stringify(typeFilters));
    }
  }, [JSON.stringify(typeFilters)]);

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
      setSearchDirty(false);
    });
  };

  useEffect(() => {
    const counts = { project: 0, task: 0, note: 0, link: 0, file: 0, session: 0, alarm: 0, userlog: 0 };
    for (const r of (searchResults || [])) {
      const k = r?.kind;
      if (Object.hasOwn(counts, k)) counts[k] += 1;
    }
    setTypeCounts(counts);

    const hasInclude = Object.values(typeFilters).some(v => v === 1);
    const filtered = (searchResults || []).filter(r => {
      const k = r?.kind;
      const st = typeFilters[k];
      if (hasInclude) return st === 1;
      return st !== -1;
    });
    setSearchFiltered(filtered);
    setSearchActiveIdx(idx => (idx >= 0 && idx < filtered.length ? idx : -1));
  }, [JSON.stringify(searchResults), JSON.stringify(typeFilters)]);

  useEffect(() => {
    if (String(searchQ).trim() && searchResults.length === 0) {
      runSearch(searchQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateForSearchResult = (result) => {
    const idFrom = (raw) => String(raw).split(':').pop();

    // Open external links directly in a new tab (and register click)
    if (result?.kind === 'link' && result?.id) {
      const id = idFrom(result.id);
      const tryOpen = (href) => {
        if (!href) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      };
      const ensureHttpUrl = (url) => {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        return /^(https?:)\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      };
      // Prefer URL provided in search result
      const directHref = ensureHttpUrl(result?.url || '');
      if (tryOpen(directHref)) {
        Meteor.call('links.registerClick', id);
        return;
      }
      // Then try client cache
      const l = LinksCollection.findOne({ _id: id }, { fields: { url: 1 } });
      const localHref = ensureHttpUrl(l?.url || '');
      if (tryOpen(localHref)) {
        Meteor.call('links.registerClick', id);
        return;
      }
      // Fallback: fetch URL from server and open it
      Meteor.call('links.getUrl', id, { registerClick: true }, (err, href) => {
        if (err) { console.error('links.getUrl failed', err); return; }
        tryOpen(href);
      });
      return;
    }

    const routeByKind = {
      project: (r) => (r?.id ? { name: 'project', projectId: idFrom(r.id) } : null),
      task: (r) => (r?.projectId ? { name: 'project', projectId: r.projectId } : null),
      line: (r) => (r?.sessionId ? { name: 'session', sessionId: r.sessionId } : null),
      note: (r) => (r?.projectId ? { name: 'project', projectId: r.projectId } : null),
      session: (r) => (r?.id ? { name: 'session', sessionId: idFrom(r.id) } : null),
      alarm: () => ({ name: 'alarms' }),
    };
    const route = routeByKind[result?.kind]?.(result) || { name: 'home' };
    navigateTo(route);
  };

  return (
    <>
      <SearchBar
        value={searchQ}
        onChange={(v) => {
          setSearchQ(v);
          setSearchDirty(true);
          setSearchActiveIdx(-1);
        }}
        onSearch={(query) => { runSearch(query); }}
        onEscape={onClose}
        resultsCount={searchResults.length}
        cached={searchCached}
        loading={searchLoading}
        cacheSize={searchCacheSize}
        autoFocus
        armSelectFirst={searchResults.length > 0 && !searchDirty}
        onSelectFirst={() => {
          if (searchResults.length === 0) return;
          const idx = (typeof searchActiveIdx === 'number' && searchActiveIdx >= 0 && searchActiveIdx < searchResults.length) ? searchActiveIdx : 0;
          const selected = searchResults[idx];
          navigateForSearchResult(selected);
          onClose();
        }}
      />
      <SearchTypeFilters value={typeFilters} onChange={setTypeFilters} counts={typeCounts} />
      <SearchResults
        results={searchFiltered}
        onAfterNavigate={(idx) => { setSearchActiveIdx(idx ?? -1); onClose(); }}
        keyboardNav={true}
        activeIdx={searchActiveIdx}
        onActiveChange={setSearchActiveIdx}
        stale={searchDirty}
      />
      <p className="muted">Tip: ⌘K / Ctrl+K to open this anywhere.</p>
    </>
  );
};

SearchPane.propTypes = {
  onClose: PropTypes.func.isRequired,
};

const CreateTaskPane = ({ defaultProjectId = '', isOpen = false }) => {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskProjectId, setNewTaskProjectId] = useState(defaultProjectId || '');
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const inputRef = useRef(null);
  const userTouchedRef = useRef(false);
  const sub = useSubscribe('projects');
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1 } })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  useEffect(() => {
    if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
  }, []);

  useEffect(() => {
    if (typeof defaultProjectId === 'string' && !userTouchedRef.current) {
      setNewTaskProjectId(defaultProjectId || '');
    }
  }, [defaultProjectId]);

  // When palette opens, reset userTouched and apply default
  useEffect(() => {
    if (!isOpen) return;
    userTouchedRef.current = false;
    if (typeof defaultProjectId === 'string') {
      setNewTaskProjectId(defaultProjectId || '');
    }
  }, [isOpen]);

  // Re-apply default when projects list changes (after subscription) if user hasn't changed it
  useEffect(() => {
    if (!isOpen) return;
    if (userTouchedRef.current) return;
    if (typeof defaultProjectId === 'string') {
      setNewTaskProjectId(defaultProjectId || '');
    }
  }, [isOpen, Array.isArray(projects) ? projects.length : 0, defaultProjectId]);

  const handleCreateTask = () => {
    const title = String(newTaskTitle || '').trim();
    if (!title) { notify({ message: 'Please enter a task title', kind: 'error' }); return; }
    if (creatingTask) return;
    setCreatingTask(true);
    const doc = { title };
    if (newTaskProjectId) doc.projectId = newTaskProjectId;
    if (newTaskDeadline && typeof newTaskDeadline === 'string') {
      const parsed = new Date(newTaskDeadline);
      if (!Number.isNaN(parsed.getTime())) doc.deadline = parsed;
    }
    Meteor.call('tasks.insert', doc, (err, res) => {
      setCreatingTask(false);
      if (err) { notify({ message: err?.reason || err?.message || 'Task creation failed', kind: 'error' }); return; }
      notify({ message: 'Task created!', kind: 'success' });
      setNewTaskTitle('');
      if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
    });
  };

  return (
    <div className="createTaskPane">
      <div className="formRow">
        <label htmlFor="cmd_new_task_title">Title</label>
        <input
          id="cmd_new_task_title"
          ref={inputRef}
          className="afInput"
          placeholder="Task title…"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleCreateTask(); }
          }}
        />
      </div>
      <div className="formRow mt8">
        <label htmlFor="cmd_new_task_project">Project (optional)</label>
        <select
          id="cmd_new_task_project"
          className="afSelect"
          value={newTaskProjectId}
          onChange={(e) => { userTouchedRef.current = true; setNewTaskProjectId(e.target.value); }}
          disabled={sub()}
        >
          <option value="">(none)</option>
          {(projects || []).map(p => (
            <option key={p._id} value={p._id}>{p.name || '(untitled project)'}</option>
          ))}
        </select>
      </div>
      <div className="formRow mt8">
        <label htmlFor="cmd_new_task_deadline">Deadline (optional)</label>
        <InlineDate
          id="cmd_new_task_deadline"
          value={newTaskDeadline}
          onSubmit={(next) => setNewTaskDeadline(next)}
          placeholder="No deadline"
        />
      </div>
      <div className="formRow mt12">
        <button className="btn btn-primary" disabled={creatingTask} onClick={handleCreateTask}>Create task</button>
        <span className="muted ml8">Enter to submit</span>
      </div>
    </div>
  );
};
CreateTaskPane.propTypes = {
  defaultProjectId: PropTypes.string,
  isOpen: PropTypes.bool,
};

const CreateNotePane = ({ defaultProjectId = '', isOpen = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);
  const contentRef = useRef(null);
  const userTouchedRef = useRef(false);
  const sub = useSubscribe('projects');
  const projects = useFind(() => ProjectsCollection.find({}, { sort: { updatedAt: -1, name: 1 }, fields: { name: 1 } }));

  useEffect(() => {
    if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
  }, []);

  useEffect(() => {
    if (typeof defaultProjectId === 'string' && !userTouchedRef.current) {
      setProjectId(defaultProjectId || '');
    }
  }, [defaultProjectId]);

  useEffect(() => {
    if (!isOpen) return;
    userTouchedRef.current = false;
    if (typeof defaultProjectId === 'string') {
      setProjectId(defaultProjectId || '');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (userTouchedRef.current) return;
    if (typeof defaultProjectId === 'string') {
      setProjectId(defaultProjectId || '');
    }
  }, [isOpen, Array.isArray(projects) ? projects.length : 0, defaultProjectId]);

  const handleCreateNote = () => {
    const t = String(title || '').trim();
    const c = String(content || '');
    if (!c.trim()) { notify({ message: 'Please enter content', kind: 'error' }); return; }
    if (creating) return;
    setCreating(true);
    const doc = { title: t || undefined, content: c };
    if (projectId) doc.projectId = projectId;
    Meteor.call('notes.insert', doc, (err, res) => {
      setCreating(false);
      if (err) { notify({ message: err?.reason || err?.message || 'Note creation failed', kind: 'error' }); return; }
      notify({ message: 'Note created', kind: 'success' });
      setTitle('');
      setContent('');
      if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
    });
  };

  return (
    <div className="createTaskPane">
      <div className="formRow">
        <label htmlFor="cmd_new_note_title">Title</label>
        <input
          id="cmd_new_note_title"
          ref={inputRef}
          className="afInput"
          placeholder="Note title… (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (typeof e.stopPropagation === 'function') e.stopPropagation();
              if (contentRef.current && typeof contentRef.current.focus === 'function') {
                contentRef.current.focus();
              }
            }
          }}
        />
      </div>
      <div className="formRow mt8" style={{ alignItems: 'flex-start' }}>
        <label htmlFor="cmd_new_note_content">Content</label>
        <textarea
          id="cmd_new_note_content"
          className="afInput"
          rows={6}
          placeholder="Write your note…"
          value={content}
          ref={contentRef}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (typeof e.stopPropagation === 'function') e.stopPropagation();
              handleCreateNote();
            }
          }}
        />
      </div>
      <div className="formRow mt8">
        <label htmlFor="cmd_new_note_project">Project (optional)</label>
        <select
          id="cmd_new_note_project"
          className="afSelect"
          value={projectId}
          onChange={(e) => { userTouchedRef.current = true; setProjectId(e.target.value); }}
          disabled={sub()}
        >
          <option value="">(none)</option>
          {(projects || []).map(p => (
            <option key={p._id} value={p._id}>{p.name || '(untitled project)'}</option>
          ))}
        </select>
      </div>
      <div className="formRow mt12">
        <button className="btn btn-primary" disabled={creating} onClick={handleCreateNote}>Create note</button>
        <span className="muted ml8">Enter to submit (if title or content)</span>
      </div>
    </div>
  );
};
CreateNotePane.propTypes = {
  defaultProjectId: PropTypes.string,
  isOpen: PropTypes.bool,
};

const CreateAlarmPane = ({ isOpen = false }) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // reset fields when opening
    setTitle('');
    setDate('');
    setTime('');
  }, [isOpen]);

  const handleCreateAlarm = () => {
    const t = String(title || '').trim();
    if (!t) { notify({ message: 'Please enter a title', kind: 'error' }); return; }
    if (!date || !time) { notify({ message: 'Please select date and time', kind: 'error' }); return; }
    if (creating) return;
    const dt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(dt.getTime())) { notify({ message: 'Invalid date/time', kind: 'error' }); return; }
    setCreating(true);
    Meteor.call('alarms.insert', {
      title: t,
      nextTriggerAt: dt,
      recurrence: { type: 'none' }
    }, (err) => {
      setCreating(false);
      if (err) { notify({ message: err?.reason || err?.message || 'Alarm creation failed', kind: 'error' }); return; }
      notify({ message: 'Alarm created', kind: 'success' });
      setTitle(''); setDate(''); setTime('');
      if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus();
    });
  };

  return (
    <div className="createTaskPane">
      <div className="formRow">
        <label htmlFor="cmd_new_alarm_title">Title</label>
        <input
          id="cmd_new_alarm_title"
          ref={inputRef}
          className="afInput"
          placeholder="Alarm title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateAlarm(); } }}
        />
      </div>
      <div className="formRow mt8">
        <label htmlFor="cmd_new_alarm_date">Date</label>
        <input
          id="cmd_new_alarm_date"
          className="afInput"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="formRow mt8">
        <label htmlFor="cmd_new_alarm_time">Time</label>
        <input
          id="cmd_new_alarm_time"
          className="afInput"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleCreateAlarm(); }
          }}
        />
      </div>
      <div className="formRow mt12">
        <button className="btn btn-primary" disabled={creating} onClick={handleCreateAlarm}>Create alarm</button>
        <span className="muted ml8">Enter to submit</span>
      </div>
    </div>
  );
};
CreateAlarmPane.propTypes = {
  isOpen: PropTypes.bool,
};

export const CommandPalette = ({ open, onClose, defaultTab, defaultProjectId = '' }) => {
  const [activeTab, setActiveTab] = useState(0); // 0 = Search, 1 = Create Task

  // Initialize active tab on open: prefer explicit defaultTab, else last used from localStorage, else 0
  useEffect(() => {
    if (!open) return;
    const fromStorage = () => {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('cmd_palette_last_tab') : null;
        const n = raw != null ? parseInt(raw, 10) : NaN;
        return Number.isFinite(n) && (n === 0 || n === 1 || n === 2 || n === 3) ? n : 0;
      } catch (e) {
        console.error('cmd_palette_last_tab read failed', e?.message || e);
        return 0;
      }
    };
    const initial = (typeof defaultTab === 'number') ? defaultTab : fromStorage();
    setActiveTab(initial);
  }, [open, defaultTab]);

  // Persist tab changes
  useEffect(() => {
    if (!open) return;
    localStorage.setItem('cmd_palette_last_tab', String(activeTab));
  }, [open, activeTab]);

  // Tab/Shift+Tab cycling across 4 tabs
  useEffect(() => {
    if (!open) return;
    const onTabCycle = (e) => {
      if (e.key !== 'Tab') return;
      // Always hijack Tab inside the palette to switch tabs
      e.preventDefault();
      e.stopPropagation();
      const tabsCount = 4;
      setActiveTab((idx) => (e.shiftKey ? (idx - 1 + tabsCount) % tabsCount : (idx + 1) % tabsCount));
    };
    // Capture phase to run before browser focus traversal
    window.addEventListener('keydown', onTabCycle, true);
    return () => window.removeEventListener('keydown', onTabCycle, true);
  }, [open]);

  // Removed duplicate Tab cycle effect

  const renderActivePane = () => {
    if (activeTab === 0) {
      return <SearchPane onClose={onClose} />;
    }
    if (activeTab === 1) {
      return <CreateTaskPane defaultProjectId={defaultProjectId} isOpen={open} />;
    }
    if (activeTab === 2) {
      return <CreateNotePane defaultProjectId={defaultProjectId} isOpen={open} />;
    }
    return <CreateAlarmPane isOpen={open} />;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Command Palette"
      icon="⌘"
      leftPanel={(
        <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
          <defs>
            <linearGradient id="cmdPaletteGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="72" height="72" rx="12" fill="#0b1020" stroke="rgba(255,255,255,0.08)" />
          <g fill="none" stroke="url(#cmdPaletteGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="30" cy="30" r="10" />
            <line x1="38" y1="38" x2="50" y2="50" />
          </g>
        </svg>
      )}
      panelClassName="wide"
      closable={false}
    >
      <Tabs active={activeTab} onChange={setActiveTab} />
      {renderActivePane()}
    </Modal>
  );
};

export default CommandPalette;

CommandPalette.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTab: PropTypes.number,
  defaultProjectId: PropTypes.string,
};


