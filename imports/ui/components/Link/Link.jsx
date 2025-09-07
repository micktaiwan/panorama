import React from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './Link.css';

export const LinkItem = ({ link, startEditing = false, hoverActions = false }) => {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(!!startEditing);
  if (!link) return null;
  const nameVal = link.name && link.name.trim() ? link.name.trim() : '';
  const urlVal = link.url || '';
  return (
    <>
      <span className={`linkPill${hoverActions && !isEditing ? ' hoverHideActions' : ''}`}>
        {isEditing ? (
          <>
            <InlineEditable
              value={nameVal}
              placeholder="(link name)"
              onSubmit={(next) => { if (link._id) Meteor.call('links.update', link._id, { name: next }); }}
            />
            <InlineEditable
              value={urlVal}
              placeholder="(url)"
              onSubmit={(next) => { if (link._id) Meteor.call('links.update', link._id, { url: next }); }}
            />
            <span className="linkActions">
              <button className="iconButton" title="Done" onClick={() => setIsEditing(false)}>✓</button>
              <button className="iconButton" title="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
            </span>
          </>
        ) : (
          <>
            <a
              className="linkAnchor"
              href={link.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (link._id) Meteor.call('links.registerClick', link._id); }}
              title={urlVal}
            >
              {nameVal || urlVal || '(link)'}
            </a>
            <span className="linkActions">
              <button className="iconButton" title="Edit" onClick={() => setIsEditing(true)}>✎</button>
              <button className="iconButton" title="Delete" onClick={() => setConfirmOpen(true)}>🗑</button>
            </span>
          </>
        )}
      </span>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete link"
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmOpen(false)}>Cancel</button>,
          <button key="del" className="btn danger" onClick={() => {
            const id = link && link._id;
            if (!id) { setConfirmOpen(false); return; }
            Meteor.call('links.remove', id, () => setConfirmOpen(false));
          }}>Delete</button>
        ]}
      >
        <div>This will permanently delete this link.</div>
      </Modal>
    </>
  );
};

LinkItem.propTypes = {
  link: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, url: PropTypes.string, clicksCount: PropTypes.number }),
  startEditing: PropTypes.bool,
  hoverActions: PropTypes.bool,
};


