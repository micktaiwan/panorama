import React, { useEffect, useRef, useState } from 'react';

import './Search.css';
import { navigateTo } from '/imports/ui/router.js';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { Meteor } from 'meteor/meteor';
import { LinksCollection } from '/imports/api/links/collections';

export const SearchResults = ({ results, onAfterNavigate, keyboardNav = false, activeIdx: activeIdxProp, onActiveChange, stale = false }) => {
  const list = Array.isArray(results) ? results : [];
  const [internalIdx, setInternalIdx] = useState(-1);
  const activeIdx = typeof activeIdxProp === 'number' ? activeIdxProp : internalIdx;
  const setActiveIdx = typeof onActiveChange === 'function' ? onActiveChange : setInternalIdx;
  const itemRefs = useRef([]);

  useEffect(() => { itemRefs.current = []; }, [list.length]);
  useEffect(() => {
    // Reset internal index when results set changes (unless controlled externally)
    if (typeof activeIdxProp !== 'number') {
      setInternalIdx(-1);
    }
  }, [list.length]);

  useEffect(() => {
    if (activeIdx >= 0 && itemRefs.current[activeIdx]) {
      itemRefs.current[activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  useEffect(() => {
    if (!keyboardNav) return;
    const onKey = (e) => {
      if (!list || list.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((idx) => (idx < 0 ? 0 : Math.min(list.length - 1, idx + 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((idx) => (idx <= 0 ? -1 : idx - 1));
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0) {
          e.preventDefault();
          activate(activeIdx);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardNav, list, activeIdx]);

  const activate = (index) => {
    const r = list[index];
    if (!r) return;
    if (r.kind === 'link' && r.id) {
      const id = String(r.id).split(':').pop();
      const l = LinksCollection.findOne({ _id: id }, { fields: { url: 1 } });
      const ensureHttpUrl = (url) => {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        return /^(https?:)\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      };
      const href = ensureHttpUrl(l?.url || '');
      if (href) {
        window.open(href, '_blank', 'noopener,noreferrer');
        Meteor.call('links.registerClick', id);
        if (onAfterNavigate) onAfterNavigate(index);
        return;
      }
    }
    if (r.kind === 'project' && r.id) {
      const id = String(r.id).split(':').pop();
      navigateTo({ name: 'project', projectId: id });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    if (r.kind === 'task' && r.projectId) {
      navigateTo({ name: 'project', projectId: r.projectId });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    if (r.kind === 'line' && r.sessionId) {
      navigateTo({ name: 'session', sessionId: r.sessionId });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    if (r.kind === 'note' && r.projectId) {
      navigateTo({ name: 'project', projectId: r.projectId });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    if (r.kind === 'session' && r.id) {
      const id = String(r.id).split(':').pop();
      navigateTo({ name: 'session', sessionId: id });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    if (r.kind === 'alarm') {
      navigateTo({ name: 'alarms' });
      if (onAfterNavigate) onAfterNavigate(index);
      return;
    }
    navigateTo({ name: 'home' });
    if (onAfterNavigate) onAfterNavigate(index);
  };

  if (list.length === 0) return null;
  return (
    <div className={`searchResults${stale ? ' stale' : ''}`}>
      <div className="searchResultsHeader"><h3>Search results</h3></div>
      <ul className="taskList">
          {list.map((r, idx) => {
            const isDone = r.kind === 'task' && (r.status === 'done');
            let icon = null;
            switch (r.kind) {
              case 'project':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12v10H2zM3 4v8h10V4z"/></svg>);
                break;
              case 'task':
                icon = isDone
                  ? (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="#22c55e" d="M6.5 10.5l-2-2L3 10l3.5 3.5L13 7l-1.5-1.5z"/></svg>)
                  : (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/></svg>);
                break;
              case 'note':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2h10v12H3zM4 3v10h8V3z"/></svg>);
                break;
              case 'session':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12v8H2zM3 12h10v2H3z"/></svg>);
                break;
              case 'line':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 4h12v1H2zm0 3h12v1H2zm0 3h12v1H2z"/></svg>);
                break;
              case 'alarm':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3a5 5 0 100 10A5 5 0 008 3zm0 1a4 4 0 110 8A4 4 0 018 4zm-.5 1h1v3.5l2 1-.5.86L7.5 8V5z"/></svg>);
                break;
              case 'link':
                icon = (<svg className="kindIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.354 11.646a3 3 0 010-4.242l2-2a3 3 0 014.242 4.242l-.793.793-.707-.707.793-.793a2 2 0 10-2.828-2.828l-2 2a2 2 0 102.828 2.828l.293-.293.707.707-.293.293a3 3 0 01-4.242 0z"/></svg>);
                break;
              default:
                icon = null;
            }
            return (
            <li
              key={r.id || `${r.kind}:${idx}`}
              className={`taskItem clickable${activeIdx === idx ? ' active' : ''}${isDone ? ' done' : ''}`}
              role="button"
              tabIndex={0}
              ref={(el) => { itemRefs.current[idx] = el; }}
              onMouseMove={() => setActiveIdx(idx)}
              onClick={() => activate(idx)}
              onKeyDown={(e) => { if (e.key === 'Enter') activate(idx); }}
            >
              <div className="taskTitle">
                <span className="taskProjectCol">
                  {icon}
                  {r.kind}
                </span>
                {r.projectName ? (
                  <Tooltip content={r.projectName} placement="top">
                    <span className="searchProject">{r.projectName}</span>
                  </Tooltip>
                ) : null}
                <span className={`searchText${isDone ? ' muted' : ''}`}>{r.text || r.id}</span>
              </div>
            <div className="taskRight"><div className="taskMeta taskMetaDefault">{typeof r.score === 'number' ? r.score.toFixed(3) : r.score}</div></div>
          </li>
        ); })}
      </ul>
    </div>
  );
};


