import React from 'react';
import PropTypes from 'prop-types';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import './NoteRow.css';

const EMPTY_ARRAY = [];

export const NoteRow = ({
  as = 'li',
  note,
  // Project context (optional)
  projectName,
  projectHref,
  projectColor,
  showProject = false,
  allowProjectChange = false,
  projectOptions = EMPTY_ARRAY,
  onMoveProject,
  // Controls
  showDelete = false,
  onRemove,
  // Typography
  textSize = 'normal',
  // Handlers
  onUpdateTitle,
}) => {
  const Container = as || 'li';
  if (!note) return null;

  return (
    <Container className={`noteRowC${showProject ? ' withProject' : ''}${textSize === 'small' ? ' smallText' : ''}`}>
      <div className="noteLeft">
        {showProject ? (() => {
          if (allowProjectChange) {
            const options = Array.isArray(projectOptions) ? projectOptions : [];
            return (
              <select
                className="noteProjectLink"
                value={note.projectId || ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  if (typeof onMoveProject === 'function') onMoveProject(val);
                }}
                title="Move to project"
              >
                <option value="">(no project)</option>
                {options.map((o) => (
                  <option key={o?.value || '__none__'} value={o?.value || ''}>{o?.label || ''}</option>
                ))}
              </select>
            );
          }
          if (projectHref) {
            return (
              <a href={projectHref} className="noteProjectLink">
                <svg className="projFlag" viewBox="0 0 16 16" aria-hidden="true">
                  <path fill={projectColor || '#6b7280'} d="M2 2v12h2V9h5l1 1h4V3h-3l-1-1H4V2H2z" />
                </svg>
                {projectName || 'Open project'}
              </a>
            );
          }
          return (<span className="noteProjectLink">—</span>);
        })() : null}
      </div>
      <div className="noteMain">
        <div className="noteTitleArea">
          <InlineEditable
            value={note.title || ''}
            placeholder="(untitled note)"
            fullWidth
            className="noteRowTitle"
            inputClassName="noteRowTitle"
            onSubmit={(next) => { onUpdateTitle?.(String(next || '').trim()); }}
          />
          {note.content ? (
            <div className="notePreview" title={note.content}>{note.content}</div>
          ) : null}
        </div>
      </div>
      <div className="noteRight">
        <div className="noteMeta">{formatDateTime(note?.createdAt)}</div>
        {showDelete ? (
          <button className="iconButton" title="Delete note" onClick={() => onRemove?.()}>🗑</button>
        ) : null}
      </div>
    </Container>
  );
};

NoteRow.propTypes = {
  as: PropTypes.oneOfType([PropTypes.string, PropTypes.elementType]),
  note: PropTypes.shape({
    _id: PropTypes.string,
    title: PropTypes.string,
    content: PropTypes.string,
    createdAt: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    projectId: PropTypes.string,
  }).isRequired,
  projectName: PropTypes.string,
  projectHref: PropTypes.string,
  projectColor: PropTypes.string,
  showProject: PropTypes.bool,
  allowProjectChange: PropTypes.bool,
  projectOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onMoveProject: PropTypes.func,
  showDelete: PropTypes.bool,
  onRemove: PropTypes.func,
  textSize: PropTypes.oneOf(['normal', 'small']),
  onUpdateTitle: PropTypes.func,
};

export default NoteRow;


