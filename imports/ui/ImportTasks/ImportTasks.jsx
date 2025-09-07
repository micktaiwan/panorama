import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Random } from 'meteor/random';
import './ImportTasks.css';

export const ImportTasks = () => {
  const [text, setText] = useState('je dois acheter du pain');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState({ projects: [], tasks: [] });
  const [createdProjects, setCreatedProjects] = useState([]);
  const [taskProjectSelections, setTaskProjectSelections] = useState({});
  const [taskDeadlineSelections, setTaskDeadlineSelections] = useState({});
  const [taskTitleEdits, setTaskTitleEdits] = useState({});
  const [savingMap, setSavingMap] = useState({});
  const isLoadingProjects = useSubscribe('projects');
  const existingProjects = useFind(() => ProjectsCollection.find({}, { sort: { updatedAt: -1 } }));
  const sanitize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // Compute names that already exist (existing or created during this session), case-insensitive
  const existingOrCreatedNames = useMemo(() => {
    const names = [];
    (existingProjects || []).forEach(p => { if (p?.name) names.push(String(p.name).trim().toLowerCase()); });
    (createdProjects || []).forEach(p => { if (p?.name) names.push(String(p.name).trim().toLowerCase()); });
    return new Set(names);
  }, [existingProjects, createdProjects]);

  // Only propose creating projects that do not already exist
  const projectsToCreate = useMemo(() => {
    const list = Array.isArray(results?.projects) ? results.projects : [];
    return list.filter(p => {
      const n = p?.name ? String(p.name).trim().toLowerCase() : '';
      return n && !existingOrCreatedNames.has(n);
    });
  }, [results, existingOrCreatedNames]);


  const analyze = () => {
    setError(null);
    setIsLoading(true);
    Meteor.call('ai.textToTasksAnalyze', text, (err, res) => {
      setIsLoading(false);
      if (err) {
        const details = err?.reason || err?.details || err?.error || err?.message;
        setError(details ? `Analysis failed: ${details}` : 'Analysis failed');
        return;
      }
      const safe = res || { projects: [], tasks: [] };
      const tasksWithIds = Array.isArray(safe.tasks)
        ? safe.tasks.map(t => ({ ...t, _cid: Random.id() }))
        : [];
      setResults({ projects: Array.isArray(safe.projects) ? safe.projects : [], tasks: tasksWithIds });
      // Reset per-row state on a new analyze
      setTaskProjectSelections({});
      setTaskDeadlineSelections({});
      setTaskTitleEdits({});
      setSavingMap({});
    });
  };

  const handleCreateProject = (p) => {
    const sanitize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    Meteor.call('projects.insert', { name: p.name, description: p.description, status: p.status || 'planned' }, (err, res) => {
      if (err) {
        setError(err.error || err.message || 'Project creation failed');
        return;
      }
      if (res) {
        setCreatedProjects(prev => {
          const next = [...prev, { _id: res, name: p.name }];
          return next;
        });
        // Update any task selection that referenced the temp create option to the real ID
        setTaskProjectSelections(prev => {
          const next = { ...prev };
          const tempVal = `__create__::${p.name}`;
          Object.keys(next).forEach(k => {
            if (next[k]?.value === tempVal) {
              next[k] = { value: res, label: p.name, type: 'created' };
            }
          });
          return next;
        });
      }
    });
  };

  const allProjectsOptions = useMemo(() => {
    const existing = (existingProjects || []).map(p => ({ value: p._id, label: p.name, type: 'existing' }));
    const created = (createdProjects || []).map(cp => ({ value: cp._id, label: cp.name, type: 'created' }));
    // Deduplicate by value (projectId). Prefer existing over created when both present.
    const map = new Map();
    existing.forEach(o => { if (o.value) map.set(o.value, o); });
    created.forEach(o => { if (o.value && !map.has(o.value)) map.set(o.value, o); });
    return Array.from(map.values());
  }, [existingProjects, createdProjects]);

  // Lowercase label → option map for fast lookup
  const projectLabelLcToOption = useMemo(() => {
    const m = new Map();
    (allProjectsOptions || []).forEach(o => {
      if (o && o.label) m.set(String(o.label).trim().toLowerCase(), o);
    });
    return m;
  }, [allProjectsOptions]);

  // Preselect project suggestions when results arrive or projects list changes
  useEffect(() => {
    if (!results || !results.tasks) return;
    const nextSelections = {};
    const nextDeadline = {};
    results.tasks.forEach((t) => {
      const cid = t._cid;
      const sugg = t.projectSuggestion;
      if (sugg && sugg.name) {
        const target = String(sugg.name).trim().toLowerCase();
        const found = projectLabelLcToOption.get(target);
        if (found) {
          nextSelections[cid] = found;
        } else if (sugg.matchType === 'new' && target && target !== 'unknown') {
          // Preselect inline create when model proposes a new concrete project
          nextSelections[cid] = { value: `__create__::${sugg.name}`, label: `Create "${sugg.name}"` };
        }
      }
      const aiDeadline = t.deadline;
      if (aiDeadline && !taskDeadlineSelections[cid]) {
        nextDeadline[cid] = aiDeadline;
      }
    });
    setTaskProjectSelections(prev => ({ ...prev, ...nextSelections }));
    if (Object.keys(nextDeadline).length > 0) {
      setTaskDeadlineSelections(prev => ({ ...prev, ...nextDeadline }));
    }
  }, [results, projectLabelLcToOption]);

  const handleSaveTask = (cid, t) => {
    const selected = taskProjectSelections[cid];
    let projectId = selected && selected.value;
    if (!projectId) {
      setError('Select a project for the task before saving');
      return;
    }
    setSavingMap(prev => ({ ...prev, [cid]: true }));
    const finishRemoveRow = () => {
      setResults(prev => ({ ...prev, tasks: prev.tasks.filter((row) => row._cid !== cid) }));
      setTaskProjectSelections(prev => { const next = { ...prev }; delete next[cid]; return next; });
      setTaskDeadlineSelections(prev => { const next = { ...prev }; delete next[cid]; return next; });
      setTaskTitleEdits(prev => { const next = { ...prev }; delete next[cid]; return next; });
      setSavingMap(prev => ({ ...prev, [cid]: false }));
    };
    const selectedDueRaw = taskDeadlineSelections[cid] ?? t.deadline;
    const dueDate = selectedDueRaw && String(selectedDueRaw).trim() !== '' ? selectedDueRaw : undefined;
    const deadline = dueDate ? new Date(dueDate) : null;
    const title = taskTitleEdits?.[cid] ?? t.title;

    // Inline create project if needed
    if (String(projectId).startsWith('__create__::')) {
      const newName = String(projectId).split('__create__::')[1];
      Meteor.call('projects.insert', { name: sanitize(newName), status: 'planned' }, (err, newProjectId) => {
        if (err) {
          setError(err.error || err.message || 'Project creation failed');
          setSavingMap(prev => ({ ...prev, [cid]: false }));
          return;
        }
        if (newProjectId) {
          setCreatedProjects(prev => [...prev, { _id: newProjectId, name: newName }]);
          const doc2 = {
            projectId: newProjectId,
            title,
            notes: t.notes,
            deadline,
            // no task status
          };
          Meteor.call('tasks.insert', doc2, (err2) => {
            if (err2) {
              setError(err2.error || err2.message || 'Task creation failed');
              setSavingMap(prev => ({ ...prev, [cid]: false }));
              return;
            }
            finishRemoveRow();
          });
        }
      });
      return;
    }
    const doc = {
      projectId,
      title,
      notes: t.notes,
      deadline,
      // no task status
    };
    Meteor.call('tasks.insert', doc, (err) => {
      if (err) {
        setError(err.error || err.message || 'Task creation failed');
        setSavingMap(prev => ({ ...prev, [cid]: false }));
        return;
      }
      finishRemoveRow();
    });
  };

  return (
    <div>
      <h2>Import tasks</h2>
      <Card title="Paste text and analyze" actions={
        <button
          className="btn btn-primary"
          onClick={analyze}
          disabled={isLoading || !text.trim()}
          aria-busy={isLoading ? 'true' : 'false'}
        >
          {isLoading ? 'Analyzing…' : 'Analyze'}
        </button>
      }>
        {error && <div className="errorBanner">{String(error)}</div>}
        {isLoading && (
          <div className="muted importLoadingNote">
            Analyzing your text…
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste free text here..."
          rows={10}
          className="importTextarea"
        />
      </Card>

      {projectsToCreate && projectsToCreate.length > 0 && (
        <Card title="Projects to create">
          <ul className="importList">
            {projectsToCreate.map((p, i) => (
              <li key={i} className="importProjectRow">
                <strong className="importProjectName">{p.name}</strong>{p.description ? ` — ${String(p.description).replace(/\s+/g, ' ').trim()}` : ''}
                <button className="btn ml8" onClick={() => handleCreateProject(p)}>Create</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {results.tasks && results.tasks.length > 0 && (
        <Card title="Tasks to add">
          <div className="importTaskHeader" aria-hidden="true">
            <div className="importTaskProjectCol importTaskHeaderCell">Project</div>
            <div className="importTaskDueCol importTaskHeaderCell">Task deadline</div>
            <div className="importTaskMainCol importTaskHeaderCell">Task</div>
            <div className="importTaskActionsCol importTaskHeaderCell">
              <Tooltip content="🗑 remove • ⏳ clear deadline • 💾 save task" placement="top">
                <span>Actions</span>
              </Tooltip>
            </div>
          </div>
          {isLoadingProjects() && (
            <div className="muted importLoadingNote">Loading projects…</div>
          )}
          <ul className="importList">
            {results.tasks.map((t) => {
              const cid = t._cid;
              const sugg = t.projectSuggestion;
              const target = sugg && sugg.name ? String(sugg.name).trim().toLowerCase() : '';
              const hasMatch = target && allProjectsOptions.some(o => String(o.label).trim().toLowerCase() === target);
              const showCreateOption = !!(sugg && sugg.name && !hasMatch && String(sugg.name).trim().toLowerCase() !== 'unknown');
              const hasLocalDeadline = Object.prototype.hasOwnProperty.call(taskDeadlineSelections, cid);
              const displayDeadline = hasLocalDeadline ? taskDeadlineSelections[cid] : t.deadline;
              return (
              <li key={cid} className="importTaskRow">
                <div className="importTaskProjectCol">
                  <select
                    value={taskProjectSelections[cid]?.value || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const option = allProjectsOptions.find(o => o.value === val) || { value: val, label: e.target.options[e.target.selectedIndex].text };
                      setTaskProjectSelections(prev => ({ ...prev, [cid]: option }));
                    }}
                    className="importTaskProjectSelect"
                    disabled={isLoadingProjects()}
                  >
                    <option value="">Select...</option>
                    {allProjectsOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {showCreateOption && (
                      <option value={`__create__::${sugg.name}`}>{`Create "${sugg.name}"`}</option>
                    )}
                  </select>
                </div>
                <div className="importTaskDueCol">
                  <input
                    type="date"
                    value={hasLocalDeadline ? taskDeadlineSelections[cid] : (t.deadline || '')}
                    onChange={(e) => setTaskDeadlineSelections(prev => ({ ...prev, [cid]: e.target.value }))}
                    className="importTaskDueInput"
                  />
                </div>
                <div className="importTaskMainCol">
                  {(t.sourceLine || t.notes) ? (
                    <Tooltip content={t.sourceLine || t.notes} placement="top" size="large">
                      <span className="importTaskText">
                        <InlineEditable
                          value={taskTitleEdits?.[cid] || t.title}
                          placeholder="(untitled)"
                          onSubmit={(next) => setTaskTitleEdits(prev => ({ ...prev, [cid]: next }))}
                        />
                        {displayDeadline ? (
                          <span className="importTaskDeadline">deadline {displayDeadline}</span>
                        ) : null}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="importTaskText">
                      <InlineEditable
                        value={taskTitleEdits?.[cid] || t.title}
                        placeholder="(untitled)"
                        onSubmit={(next) => setTaskTitleEdits(prev => ({ ...prev, [cid]: next }))}
                      />
                      {displayDeadline ? (
                        <span className="importTaskDeadline">deadline {displayDeadline}</span>
                      ) : null}
                    </span>
                  )}
                </div>
                <div className="importTaskActionsCol">
                  <button
                    className="iconButton"
                    title="Remove from import"
                    onClick={() => setResults(prev => ({ ...prev, tasks: prev.tasks.filter((row) => row._cid !== cid) }))}
                  >
                    🗑
                  </button>
                  <button
                    className="iconButton"
                    disabled={!displayDeadline}
                    title="Clear deadline"
                    onClick={() => setTaskDeadlineSelections(prev => ({ ...prev, [cid]: '' }))}
                  >
                    ⏳
                  </button>
                  <button
                    className="iconButton"
                    disabled={!taskProjectSelections[cid]?.value}
                    title={!taskProjectSelections[cid]?.value ? 'Select a project first' : 'Save task'}
                    onMouseDown={() => { const el = document.activeElement; if (el && typeof el.blur === 'function') { el.blur(); } }}
                    onClick={() => setTimeout(() => handleSaveTask(cid, t), 0)}
                  >
                    💾
                  </button>
                </div>
              </li>
            );})}
          </ul>
        </Card>
      )}
    </div>
  );
};


