import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './PanoramaPage.css';

export const PanoramaPage = () => {
  const [periodDays, setPeriodDays] = useState(14);
  const [query, setQuery] = useState('');

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState(() => {
    if (typeof localStorage === 'undefined') return 'custom';
    const v = localStorage.getItem('panorama_sort') || 'custom';
    return ['custom','createdAtAsc','createdAtDesc','overdueDesc'].includes(v) ? v : 'custom';
  }); // custom | createdAtAsc | createdAtDesc | overdueDesc

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

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('panorama_sort', sortMode);
  }, [sortMode]);

  const [activityFilter, setActivityFilter] = useState('all'); // all | active | inactive
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = data.filter(p => (p.name || '').toLowerCase().includes(q) || (p.tags || []).some(t => t.toLowerCase().includes(q)));
    if (activityFilter !== 'all') {
      arr = arr.filter(p => {
        const changes = (p?.heat?.notes || 0) + (p?.heat?.tasksChanged || 0);
        return activityFilter === 'active' ? changes > 0 : changes === 0;
      });
    }
    return arr;
  }, [data, query, activityFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortMode === 'createdAtAsc') {
      return arr.sort((a, b) => (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()));
    }
    if (sortMode === 'createdAtDesc') {
      return arr.sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    }
    if (sortMode === 'overdueDesc') {
      return arr.sort((a, b) => ((b?.tasks?.overdue || 0) - (a?.tasks?.overdue || 0)));
    }
    if (sortMode === 'activityDesc') {
      return arr.sort((a, b) => (((b?.heat?.notes || 0) + (b?.heat?.tasksChanged || 0)) - ((a?.heat?.notes || 0) + (a?.heat?.tasksChanged || 0))));
    }
    // custom: by panoramaRank asc nulls last, then name
    return arr.sort((a, b) => {
      const ar = Number.isFinite(a.panoramaRank) ? a.panoramaRank : Number.POSITIVE_INFINITY;
      const br = Number.isFinite(b.panoramaRank) ? b.panoramaRank : Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [filtered, sortMode]);

  const hotspots = useMemo(() => {
    const overdue = filtered.filter(p => (p?.tasks?.overdue || 0) > 0);
    const dormant = filtered.filter(p => p?.dormant);
    const blockers = filtered.filter(p => (p?.tasks?.blocked || 0) > 0 || (p?.notes?.blockers7d || 0) > 0);
    return { overdue, dormant, blockers };
  }, [filtered]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));
  const ids = useMemo(() => sorted.map(p => p._id), [sorted]);
  const onDragEnd = (event) => {
    if (sortMode !== 'custom') return;
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    const nextOrder = arrayMove(ids, oldIndex, newIndex);
    // assign new ranks spaced by 10 for future inserts
    nextOrder.forEach((id, idx) => { Meteor.call('panorama.setRank', id, idx * 10); });
    const rankMap = new Map(nextOrder.map((id, idx) => [id, idx * 10]));
    setData(prev => prev.map(p => (rankMap.has(p._id) ? { ...p, panoramaRank: rankMap.get(p._id) } : p)));
  };

  const ProjectCardItem = ({ p }) => {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: p._id, disabled: sortMode !== 'custom' });
    const style = { transform: CSS.Transform.toString(transform), transition };
    return (
      <div ref={setNodeRef} style={style} className={`ProjectCard${isDragging ? ' dragging' : ''}`}>
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
            {!!p?.tasks?.overdue && <span className="chip danger">{p.tasks.overdue} overdue</span>}
            {!!p?.tasks?.blocked && <span className="chip warn">{p.tasks.blocked} blocked</span>}
            {p.dormant && <span className="chip idle">Dormant</span>}
            {((p?.heat?.notes || 0) + (p?.heat?.tasksChanged || 0)) === 0 && (
              <span className="chip">Inactive</span>
            )}
          </div>
        </div>
        <div className="meta">
          <span>Last activity: {new Date(p.lastActivityAt).toLocaleDateString()}</span>
          <span>Health: {p?.health?.score ?? '-'}</span>
          <span>Heat: {p?.heat?.notes || 0}n / {p?.heat?.tasksChanged || 0}t</span>
        </div>
        <div className="next">
          <div className="sectionTitle">Next actions</div>
          {(p?.tasks?.next || []).slice(0, 3).map(t => (
            <div key={t._id} className="taskRow">{t.title}</div>
          ))}
        </div>
        <div className="notes">
          <div className="sectionTitle">Notes</div>
          <div className="noteSummary">
            <span>Status: {p?.notes?.lastStatusAt ? new Date(p.notes.lastStatusAt).toLocaleDateString() : '—'}</span>
            <span>Decisions 7d: {p?.notes?.decisions7d ?? 0}</span>
            <span>Risks 7d: {p?.notes?.risks7d ?? 0}</span>
          </div>
        </div>
      </div>
    );
  };
  ProjectCardItem.propTypes = {
    p: PropTypes.shape({
      _id: PropTypes.string.isRequired,
      name: PropTypes.string,
      dormant: PropTypes.bool,
      lastActivityAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date), PropTypes.number]),
      heat: PropTypes.shape({ notes7d: PropTypes.number, tasksChanged7d: PropTypes.number }),
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
        <span className={`chip${hotspots.blockers.length ? ' warn' : ''}`}>Blockers: {hotspots.blockers.length}</span>
        <span className={`chip${hotspots.dormant.length ? ' idle' : ''}`}>Dormant: {hotspots.dormant.length}</span>
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


