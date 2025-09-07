import React from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './File.css';

export const FileItem = ({ file, startEditing = false, hoverActions = false }) => {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(!!startEditing);
  if (!file) return null;
  const nameVal = file.name && file.name.trim() ? file.name.trim() : '';
  const href = file.storedFileName ? `/files/${encodeURIComponent(file.storedFileName)}` : '#';
  const label = nameVal || file.originalName || '(file)';
  return (
    <>
      <span className={`filePill${hoverActions && !isEditing ? ' hoverHideActions' : ''}`}>
        {isEditing ? (
          <>
            <InlineEditable
              value={nameVal}
              placeholder="(file name)"
              onSubmit={(next) => { if (file._id) Meteor.call('files.update', file._id, { name: next }); }}
            />
            <span className="fileActions">
              <button className="iconButton" title="Done" onClick={() => setIsEditing(false)}>✓</button>
              <button className="iconButton" title="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
            </span>
          </>
        ) : (
          <>
            <a
              className="fileAnchor"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (file._id) Meteor.call('files.registerClick', file._id); }}
              title={file.originalName || ''}
            >
              {label}
            </a>
            <span className="fileActions">
              <button className="iconButton" title="Edit" onClick={() => setIsEditing(true)}>✎</button>
              <button className="iconButton" title="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
            </span>
          </>
        )}
      </span>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete file"
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmOpen(false)}>Cancel</button>,
          <button key="del" className="btn danger" onClick={() => {
            const id = file && file._id;
            if (!id) { setConfirmOpen(false); return; }
            Meteor.call('files.remove', id, () => setConfirmOpen(false));
          }}>Delete</button>
        ]}
      >
        <div>This will permanently delete this file entry and its stored content.</div>
      </Modal>
    </>
  );
};

FileItem.propTypes = {
  file: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, originalName: PropTypes.string, storedFileName: PropTypes.string, clicksCount: PropTypes.number }),
  startEditing: PropTypes.bool,
  hoverActions: PropTypes.bool,
};


