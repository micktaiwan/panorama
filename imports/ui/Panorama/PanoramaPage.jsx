import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDate } from '/imports/ui/utils/date.js';
import './PanoramaPage.css';

// Utility functions to reduce code duplication
const sortInactiveLast = (a, b) => {
  if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1;
  return 0;
};

const getHeatScore = (project) => {
  return (project?.heat?.notes || 0) + (project?.heat?.tasksChanged || 0);
};

const getHealthScore = (project) => {
  return project?.health?.score ?? 0;
};

const getActivityTime = (project) => {
  return project.lastActivityAt ? new Date(project.lastActivityAt).getTime() : 0;
};

const createSortFunction = (primarySort, secondarySort = sortInactiveLast) => {
  return (a, b) => {
    const result = primarySort(a, b);
    if (result !== 0) return result;
    return secondarySort(a, b);
  };
};

// Utility function for localStorage with fallback
const useLocalStorage = (key, defaultValue, validator = null) => {
  const [value, setValue] = useState(() => {
    if (typeof localStorage === 'undefined') return defaultValue;
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    
    if (validator) {
      return validator(stored) ? stored : defaultValue;
    }
    
    return stored;
  });
  
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  }, [key, value]);
  
  return [value, setValue];
};

// Utility functions for filtering
const filterByQuery = (projects, query) => {
  const q = query.trim().toLowerCase();
  return projects.filter(p => 
    (p.name || '').toLowerCase().includes(q) || 
    (p.tags || []).some(t => t.toLowerCase().includes(q))
  );
};

const filterByActivity = (projects, activityFilter) => {
  if (activityFilter === 'all') return projects;
  return projects.filter(p => 
    activityFilter === 'active' ? !p.isInactive : p.isInactive
  );
};

// Utility function for hotspots calculation
const calculateHotspots = (projects) => {
  return {
    overdue: projects.filter(p => (p?.tasks?.overdue || 0) > 0),
    inactive: projects.filter(p => p?.isInactive)
  };
};

export const PanoramaPage = () => {
  const [periodDays, setPeriodDays] = useLocalStorage('panorama_period_days', 14, (value) => {
    const n = Number(value);
    return [7, 14, 30].includes(n);
  });
  const [query, setQuery] = useLocalStorage('panorama_query', '');
  const [sortMode, setSortMode] = useLocalStorage('panorama_sort', 'custom', (value) => {
    return ['custom','createdAtAsc','createdAtDesc','overdueDesc','activityDesc','heatDesc','healthDesc'].includes(value);
  });
  const [activityFilter, setActivityFilter] = useLocalStorage('panorama_activity', 'all', (value) => {
    return ['all','active','inactive'].includes(value);
  });

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Meteor.call('panorama.getOverview', { periodDays }, (err, res) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('panorama.getOverview failed', err);
        setData([]);
        setLoading(false);
        return;
      }
      setData(Array.isArray(res) ? res : []);
      setLoading(false);
    });
  }, [periodDays]);
  const filtered = useMemo(() => {
    return filterByActivity(filterByQuery(data, query), activityFilter);
  }, [data, query, activityFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    
    // Define sort functions for each mode
    const sortFunctions = {
      createdAtAsc: (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      createdAtDesc: (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      overdueDesc: (a, b) => (b?.tasks?.overdue || 0) - (a?.tasks?.overdue || 0),
      activityDesc: (a, b) => getActivityTime(b) - getActivityTime(a),
      heatDesc: (a, b) => getHeatScore(b) - getHeatScore(a),
      healthDesc: (a, b) => getHealthScore(b) - getHealthScore(a),
      custom: (a, b) => {
        const ar = Number.isFinite(a.panoramaRank) ? a.panoramaRank : Number.POSITIVE_INFINITY;
        const br = Number.isFinite(b.panoramaRank) ? b.panoramaRank : Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
    };
    
    const primarySort = sortFunctions[sortMode] || sortFunctions.custom;
    const shouldSortInactiveLast = ['activityDesc', 'heatDesc', 'healthDesc'].includes(sortMode);
    
    if (shouldSortInactiveLast) {
      return arr.sort(createSortFunction(primarySort));
    }
    
    return arr.sort(primarySort);
  }, [filtered, sortMode]);

  const hotspots = useMemo(() => calculateHotspots(filtered), [filtered]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));
  const ids = useMemo(() => sorted.map(p => p._id), [sorted]);
  const onDragEnd = (event) => {
    if (sortMode !== 'custom') return;
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    const nextOrder = arrayMove(ids, oldIndex, newIndex);
    
    // Bug 4 fix: Prevent race conditions with optimistic updates
    const rankMap = new Map(nextOrder.map((id, idx) => [id, idx * 10]));
    
    // Update local state first (optimistic update)
    setData(prev => prev.map(p => (rankMap.has(p._id) ? { ...p, panoramaRank: rankMap.get(p._id) } : p)));
    
    // Then update server with error handling
    const updatePromises = nextOrder.map((id, idx) => 
      new Promise((resolve, reject) => {
        Meteor.call('panorama.setRank', id, idx * 10, (error) => {
          if (error) {
            console.error('Failed to update rank for project:', id, error);
            reject(error);
          } else {
            resolve();
          }
        });
      })
    );
    
    // Handle any failures by reverting the optimistic update
    Promise.allSettled(updatePromises).then((results) => {
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length > 0) {
        console.error('Some rank updates failed, reverting optimistic update');
        // Revert to previous state by refetching data
        Meteor.call('panorama.getOverview', { periodDays }, (err, res) => {
          if (!err && Array.isArray(res)) {
            setData(res);
          }
        });
      }
    });
  };

  const ProjectCardItem = ({ p }) => {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: p._id, disabled: sortMode !== 'custom' });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const status = p?.panoramaStatus || '';
    const statusClass = status ? ` status-${status}` : '';
    return (
      <div ref={setNodeRef} style={style} className={`ProjectCard${statusClass}${isDragging ? ' dragging' : ''}`}>
        <div className="header">
          <div className="title">
            {sortMode === 'custom' ? (
              <span className="dragHandle" title="Drag to reorder" {...attributes} {...listeners}>⠿</span>
            ) : null}
            <button
              type="button"
              className="clickable"
              onClick={() => { window.location.hash = `#/projects/${p._id}`; }}
            >
              {p.name || '(untitled project)'}
            </button>
          </div>
          <div className="badges">
            <select
              className="statusSelect"
              value={status}
              onChange={(e) => {
                const v = e.target.value;
                setData(prev => prev.map(x => x._id === p._id ? { ...x, panoramaStatus: v || null } : x));
                Meteor.call('projects.update', p._id, { panoramaStatus: v || null });
              }}
              title={
                status === 'red' ? 'Important: immediate attention required' :
                status === 'orange' ? 'Attention: watch closely' :
                status === 'green' ? 'All good / personal' : 'No status'
              }
            >
              <option value="">—</option>
              <option value="red">Red</option>
              <option value="orange">Orange</option>
              <option value="green">Green</option>
            </select>
            {!!p?.tasks?.overdue && <span className="chip danger">{p.tasks.overdue} overdue</span>}
            {!!p?.tasks?.blocked && <span className="chip warn">{p.tasks.blocked} blocked</span>}
            {p.isInactive && <span className="chip idle">Inactive</span>}
          </div>
        </div>
        <div className="meta">
          <span>Last activity: {p.lastActivityAt ? formatDate(p.lastActivityAt) : '—'}</span>
          <span>Health: {p?.health?.score ?? '-'}</span>
          <span>Heat: {p?.heat?.notes || 0}n / {p?.heat?.tasksChanged || 0}t</span>
        </div>
        <div className="next">
          <div className="sectionTitle">Next actions</div>
          {(p?.tasks?.next || []).slice(0, 5).map(t => (
            <div key={t._id} className="taskRow">{t.title}</div>
          ))}
        </div>
        {/* Notes summary removed per request */}
      </div>
    );
  };
  ProjectCardItem.propTypes = {
    p: PropTypes.shape({
      _id: PropTypes.string.isRequired,
      name: PropTypes.string,
      isInactive: PropTypes.bool,
      lastActivityAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date), PropTypes.number, PropTypes.oneOf([null])]),
      heat: PropTypes.shape({ notes: PropTypes.number, tasksChanged: PropTypes.number }),
      health: PropTypes.shape({ score: PropTypes.number }),
      tasks: PropTypes.shape({
        overdue: PropTypes.number,
        blocked: PropTypes.number,
        next: PropTypes.arrayOf(PropTypes.shape({ _id: PropTypes.string.isRequired, title: PropTypes.string }))
      }),
      notes: PropTypes.shape({ lastStatusAt: PropTypes.any, decisions7d: PropTypes.number, risks7d: PropTypes.number })
    }).isRequired
  };

  return (
    <div className="PanoramaPage">
      <div className="panoramaToolbar">
        <div className="left">
          <input
            className="input"
            placeholder="Filter by name or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="right">
          <label className="label" htmlFor="panorama_sort">Sort</label>
          <select id="panorama_sort" className="select" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
            <option value="custom">Custom (drag & drop)</option>
            <option value="createdAtAsc">Created ↑</option>
            <option value="createdAtDesc">Created ↓</option>
            <option value="overdueDesc">Overdue ↓</option>
            <option value="activityDesc">Activity ↓</option>
            <option value="heatDesc">Heat ↓</option>
            <option value="healthDesc">Health ↓</option>
          </select>
          <label className="label" htmlFor="panorama_activity">Activity</label>
          <select id="panorama_activity" className="select" value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active in period</option>
            <option value="inactive">Inactive in period</option>
          </select>
          <label className="label" htmlFor="panorama_period">Period</label>
          <select id="panorama_period" className="select" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value) || 14)}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : null}

      <div className="hotspots">
        <span className={`chip${hotspots.overdue.length ? ' danger' : ''}`}>Overdue: {hotspots.overdue.length}</span>
        <span className={`chip${hotspots.inactive.length ? ' idle' : ''}`}>Inactive: {hotspots.inactive.length}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div className="ProjectGrid">
        {sorted.map((p) => (
          <ProjectCardItem key={p._id} p={p} />
        ))}
      </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default PanoramaPage;


