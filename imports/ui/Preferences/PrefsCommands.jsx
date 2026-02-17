import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeCommandsCollection } from '/imports/api/claudeCommands/collections';
import { ClaudeProjectsCollection } from '/imports/api/claudeProjects/collections';
import { notify } from '../utils/notify.js';
import { Modal } from '../components/Modal/Modal.jsx';
import { CommandForm } from './CommandForm.jsx';

const BUILTIN_COMMANDS = [
  { name: 'clear', description: 'Clear messages and start fresh', hasArgs: false },
  { name: 'stop', description: 'Stop the running process', hasArgs: false },
  { name: 'model', description: 'Change model (e.g. /model claude-sonnet-4-20250514)', hasArgs: true },
  { name: 'cwd', description: 'Change working directory (WARNING: stops active session)', hasArgs: true },
  { name: 'codex', description: 'Run Codex CLI one-shot (e.g. /codex review changes)', hasArgs: true },
  { name: 'debate', description: 'Start a debate between Claude and Codex', hasArgs: true },
  { name: 'info', description: 'Show Claude version and context usage', hasArgs: false },
  { name: 'help', description: 'Show available commands', hasArgs: false },
];

export const PrefsCommands = () => {
  const sub = useSubscribe('claudeCommands');
  useSubscribe('claudeProjects');
  const commands = useFind(() => ClaudeCommandsCollection.find({}, { sort: { name: 1 } }));
  const claudeProjects = useFind(() => ClaudeProjectsCollection.find({}, { fields: { name: 1 } }));
  const projectNameById = React.useMemo(() => {
    const map = {};
    claudeProjects.forEach(p => { map[p._id] = p.name; });
    return map;
  }, [claudeProjects]);

  const [filter, setFilter] = React.useState('all');
  const [editing, setEditing] = React.useState(null);
  const [showForm, setShowForm] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(null);

  const filtered = React.useMemo(() => {
    if (filter === 'all') return commands;
    return commands.filter(c => c.scope === filter);
  }, [commands, filter]);

  const handleImport = () => {
    setImporting(true);
    Meteor.call('claudeCommands.importFromDisk', { global: true, allProjects: true }, (err, res) => {
      setImporting(false);
      if (err) {
        notify({ message: `Import failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      const msg = `Imported ${res.imported} command(s)`;
      const extra = res.errors?.length ? `, ${res.errors.length} error(s)` : '';
      notify({ message: msg + extra, kind: res.errors?.length ? 'info' : 'success' });
    });
  };

  const handleDelete = (cmd) => {
    Meteor.call('claudeCommands.remove', cmd._id, (err) => {
      if (err) notify({ message: `Delete failed: ${err.reason || err.message}`, kind: 'error' });
      else notify({ message: `Command /${cmd.name} deleted`, kind: 'success' });
    });
    setConfirmDelete(null);
  };

  const handleSave = (data) => {
    if (editing) {
      Meteor.call('claudeCommands.update', editing._id, data, (err) => {
        if (err) { notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' }); return; }
        notify({ message: `Command /${data.name} updated`, kind: 'success' });
        setEditing(null);
        setShowForm(false);
      });
    } else {
      Meteor.call('claudeCommands.create', data, (err) => {
        if (err) { notify({ message: `Create failed: ${err.reason || err.message}`, kind: 'error' }); return; }
        notify({ message: `Command /${data.name} created`, kind: 'success' });
        setShowForm(false);
      });
    }
  };

  if (sub()) return <div>Loading...</div>;

  return (
    <>
      <h3>Claude Code Commands</h3>
      <div className="muted" style={{ fontSize: '13px', marginBottom: '12px' }}>
        Slash commands for the integrated Claude Code terminal.
      </div>

      <h4>Built-in</h4>
      <div className="prefsSection">
        {BUILTIN_COMMANDS.map(cmd => (
          <div key={cmd.name} className="prefsRow">
            <div className="prefsLabel">
              <strong>/{cmd.name}</strong>
            </div>
            <div className="prefsValue">
              <span>{cmd.description}</span>
              {cmd.hasArgs && (
                <span style={{ marginLeft: '8px', padding: '1px 6px', background: 'var(--bg-secondary)', borderRadius: '3px', fontSize: '11px', color: 'var(--muted)' }}>
                  args
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <h4>Custom</h4>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Actions</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>New Command</button>
            <button className="btn ml8" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : 'Import from disk'}
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Filter</div>
          <div className="prefsValue">
            <div style={{ display: 'flex', gap: '8px' }}>
              {['all', 'global', 'project'].map(f => (
                <button
                  key={f}
                  className={`btn${filter === f ? ' btn-primary' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span className="muted" style={{ marginLeft: '8px', alignSelf: 'center' }}>
                {filtered.length} command(s)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="prefsSection">
        {filtered.length === 0 ? (
          <div className="prefsRow">
            <div className="prefsLabel" />
            <div className="prefsValue muted">
              No commands yet. Create one or import from disk (~/.claude/commands/*.md).
            </div>
          </div>
        ) : (
          filtered.map(cmd => (
            <div key={cmd._id} className="prefsRow" style={{ alignItems: 'flex-start' }}>
              <div className="prefsLabel">
                <strong>/{cmd.name}</strong>
                <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
                  {cmd.scope === 'project' && cmd.projectId ? (projectNameById[cmd.projectId] || cmd.projectId) : cmd.scope}
                  {cmd.source === 'disk' && <span className="ml8" style={{ color: 'var(--text-secondary)' }}>(disk)</span>}
                </div>
              </div>
              <div className="prefsValue">
                <div>{cmd.description || <span className="muted">No description</span>}</div>
                {cmd.hasArgs && (
                  <span style={{ display: 'inline-block', marginTop: '4px', padding: '1px 6px', background: 'var(--bg-secondary)', borderRadius: '3px', fontSize: '11px', color: 'var(--muted)' }}>
                    $ARGUMENTS
                  </span>
                )}
                <div style={{ marginTop: '6px' }}>
                  <button className="btn" style={{ fontSize: '12px', padding: '2px 8px' }} onClick={() => { setEditing(cmd); setShowForm(true); }}>
                    Edit
                  </button>
                  <button
                    className="btn ml8"
                    style={{ fontSize: '12px', padding: '2px 8px' }}
                    onClick={(e) => {
                      if (e.shiftKey) handleDelete(cmd);
                      else setConfirmDelete(cmd);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <CommandForm
          command={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete /${confirmDelete?.name}?`}
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>,
          <button key="ok" className="btn" onClick={() => handleDelete(confirmDelete)}>Delete</button>
        ]}
      >
        <p>This command will be permanently deleted.</p>
        <p className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>Tip: Hold Shift when clicking Delete to skip this confirmation.</p>
      </Modal>
    </>
  );
};
