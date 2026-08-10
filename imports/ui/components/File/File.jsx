import React from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
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
              <Tooltip content="Done">
                <button className="iconButton" aria-label="Done" onClick={() => setIsEditing(false)}>✓</button>
              </Tooltip>
              <Tooltip content="Delete">
                <button className="iconButton" aria-label="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
              </Tooltip>
            </span>
          </>
        ) : (
          <>
            <Tooltip content={file.originalName || ''}>
              <a
                className="fileAnchor"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { if (file._id) Meteor.call('files.registerClick', file._id); }}
              >
                {label}
              </a>
            </Tooltip>
            <span className="fileActions">
              <Tooltip content="Edit">
                <button className="iconButton" aria-label="Edit" onClick={() => setIsEditing(true)}>✎</button>
              </Tooltip>
              <Tooltip content="Delete">
                <button className="iconButton" aria-label="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
              </Tooltip>
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
          <button key="del" className="btn btn-danger" onClick={() => {
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


