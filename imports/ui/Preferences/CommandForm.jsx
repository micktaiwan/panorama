import React from 'react';
import { Modal } from '../components/Modal/Modal.jsx';

export const CommandForm = ({ command, onSave, onClose }) => {
  const [name, setName] = React.useState(command?.name || '');
  const [description, setDescription] = React.useState(command?.description || '');
  const [scope, setScope] = React.useState(command?.scope || 'global');
  const [content, setContent] = React.useState(command?.content || '');

  const handleSubmit = () => {
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmedName) return;
    onSave({ name: trimmedName, description: description.trim(), scope, content });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={command ? `Edit /${command.name}` : 'New Command'}
      actions={[
        <button key="cancel" className="btn" onClick={onClose}>Cancel</button>,
        <button key="save" className="btn btn-primary" onClick={handleSubmit} disabled={!name.trim()}>
          {command ? 'Update' : 'Create'}
        </button>
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--muted)' }}>Name</label>
          <input
            className="afInput"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder="my-command"
            style={{ width: '100%' }}
            autoFocus
          />
          <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
            Lowercase, hyphens only. Will be used as /{name || 'name'}
          </div>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--muted)' }}>Description</label>
          <input
            className="afInput"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this command does"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--muted)' }}>Scope</label>
          <select className="afInput" value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: '100%' }}>
            <option value="global">Global</option>
            <option value="project">Project</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--muted)' }}>
            Content (prompt template)
          </label>
          <textarea
            className="afInput"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'Use $ARGUMENTS as a placeholder for command arguments.\n\nExample:\nReview the following code and suggest improvements:\n$ARGUMENTS'}
            rows={10}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', resize: 'vertical' }}
          />
          <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
            {content.includes('$ARGUMENTS')
              ? '$ARGUMENTS will be replaced with the text after the command name'
              : 'Tip: Include $ARGUMENTS to accept arguments (e.g. /my-command some text)'}
          </div>
        </div>
      </div>
    </Modal>
  );
};
