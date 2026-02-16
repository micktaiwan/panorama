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

const STATUS_CYCLE = ['', 'red', 'orange', 'green'];

export const PanoramaPage = () => {
  const [periodDays, setPeriodDays] = useLocalStorage('panorama_period_days', 14, (value) => {
    const n = Number(value);
    return [1, 7, 14, 30].includes(n);
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

    const rankMap = new Map(nextOrder.map((id, idx) => [id, idx * 10]));

    setData(prev => prev.map(p => (rankMap.has(p._id) ? { ...p, panoramaRank: rankMap.get(p._id) } : p)));

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

    Promise.allSettled(updatePromises).then((results) => {
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length > 0) {
        console.error('Some rank updates failed, reverting optimistic update');
        Meteor.call('panorama.getOverview', { periodDays }, (err, res) => {
          if (!err && Array.isArray(res)) {
            setData(res);
          }
        });
      }
    });
  };

  const ProjectCardItem = ({ p, index }) => {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: p._id, disabled: sortMode !== 'custom' });
    const style = { transform: CSS.Transform.toString(transform), transition, '--i': Math.min(index, 15) };
    const status = p?.panoramaStatus || '';
    const statusClass = status ? ` status-${status}` : '';
    const healthScore = p?.health?.score;
    const healthColor = typeof healthScore === 'number'
      ? (healthScore >= 60 ? 'good' : healthScore >= 30 ? 'warn' : 'bad')
      : '';

    const cycleStatus = (e) => {
      e.stopPropagation();
      const idx = STATUS_CYCLE.indexOf(status);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      setData(prev => prev.map(x => x._id === p._id ? { ...x, panoramaStatus: next || null } : x));
      Meteor.call('projects.update', p._id, { panoramaStatus: next || null });
    };

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
            <button
              type="button"
              className={`statusDot${status ? ` s-${status}` : ''}`}
              title={
                status === 'red' ? 'Important — click for Orange' :
                status === 'orange' ? 'Attention — click for Green' :
                status === 'green' ? 'All good — click to clear' :
                'No status — click for Red'
              }
              onClick={cycleStatus}
            />
            {!!p?.tasks?.overdue && <span className="chip danger">{p.tasks.overdue} overdue</span>}
            {p.isInactive && <span className="chip idle">Inactive</span>}
          </div>
        </div>

        <div className="metrics">
          <div className="metric">
            <span className="metricLabel">Last</span>
            <span className="metricValue">{p.lastActivityAt ? formatDate(p.lastActivityAt) : '—'}</span>
          </div>
          {typeof healthScore === 'number' && (
            <div className="metric metricHealth">
              <span className="metricLabel">Health</span>
              <span className="healthBar">
                <span className={`healthFill ${healthColor}`} style={{ width: `${Math.min(100, healthScore)}%` }} />
              </span>
              <span className="metricValue">{healthScore}</span>
            </div>
          )}
          <div className="metric">
            <span className="metricLabel">Heat</span>
            <span className="metricValue heatValue">
              <span className="heatN">{p?.heat?.notes || 0}n</span>
              <span className="heatT">{p?.heat?.tasksChanged || 0}t</span>
            </span>
          </div>
        </div>

        {(p?.tasks?.next || []).length > 0 && (
          <div className="next">
            <div className="sectionTitle">Next actions</div>
            {(p.tasks.next).slice(0, 5).map(t => (
              <div key={t._id} className="taskRow">{t.title}</div>
            ))}
          </div>
        )}
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
        next: PropTypes.arrayOf(PropTypes.shape({ _id: PropTypes.string.isRequired, title: PropTypes.string }))
      }),
      panoramaStatus: PropTypes.string,
    }).isRequired,
    index: PropTypes.number.isRequired,
  };

  return (
    <div className="PanoramaPage">
      <div className="panoramaToolbar">
        <div className="searchWrap">
          <svg className="searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="input searchInput"
            placeholder="Filter by name or tag..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="toolbarSep" />

        <div className="toolbarGroup">
          <select className="select" value={sortMode} onChange={(e) => setSortMode(e.target.value)} title="Sort projects">
            <option value="custom">Custom</option>
            <option value="createdAtAsc">Created &#8593;</option>
            <option value="createdAtDesc">Created &#8595;</option>
            <option value="overdueDesc">Overdue &#8595;</option>
            <option value="activityDesc">Activity &#8595;</option>
            <option value="heatDesc">Heat &#8595;</option>
            <option value="healthDesc">Health &#8595;</option>
          </select>
        </div>

        <div className="pillGroup" role="radiogroup" aria-label="Activity filter">
          {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={activityFilter === v}
              className={`pill${activityFilter === v ? ' active' : ''}`}
              onClick={() => setActivityFilter(v)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pillGroup" role="radiogroup" aria-label="Period">
          {[1, 7, 14, 30].map(d => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={Number(periodDays) === d}
              className={`pill${Number(periodDays) === d ? ' active' : ''}`}
              onClick={() => setPeriodDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="signalStrip">
        <span className="signalItem">
          <span className="signalCount">{filtered.length}</span> project{filtered.length !== 1 ? 's' : ''}
        </span>
        {hotspots.overdue.length > 0 && (
          <span className="signalItem signalDanger">
            <span className="signalDot" />
            {hotspots.overdue.length} overdue
          </span>
        )}
        {hotspots.inactive.length > 0 && (
          <span className="signalItem signalIdle">
            <span className="signalDot" />
            {hotspots.inactive.length} inactive
          </span>
        )}
      </div>

      {loading && <div className="loadingBar"><div className="loadingProgress" /></div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="ProjectGrid">
            {sorted.map((p, i) => (
              <ProjectCardItem key={p._id} p={p} index={i} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!loading && sorted.length === 0 && (
        <div className="emptyState">No projects match your filters</div>
      )}
    </div>
  );
};

export default PanoramaPage;
