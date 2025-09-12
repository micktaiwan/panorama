import React from 'react';
import PropTypes from 'prop-types';
import './EntryRow.css';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';

export const EntryRow = ({
  entry,
  isCleaning,
  onClean,
  onUpdateContent,
  formatHms,
  timeAgo,
  isLinked,
  onOpenLinkedProject,
}) => {
  return (
    <div className="UserLog__entry">
      <button
        className="iconButton UserLog__action"
        disabled={!!isCleaning}
        onClick={() => onClean(entry)}
        aria-label={isCleaning ? 'Correction en cours' : 'Corriger la ligne'}
        title={isCleaning ? 'Correction en cours…' : 'Corriger l\'orthographe (IA)'}
      >{isCleaning ? '⏳' : '🪄'}</button>
      <div className="UserLog__entryBody">
        <div className="UserLog__entryClock">
          {formatHms(entry.createdAt)}
          {isLinked ? (
            <button
              type="button"
              className="UserLog__linkedIcon"
              title="Open project for linked task"
              onClick={() => onOpenLinkedProject(entry)}
            >🔗</button>
          ) : null}
        </div>
        <div className="UserLog__entryText">
          <InlineEditable
            value={entry.content || ''}
            placeholder="(vide)"
            onSubmit={(next) => onUpdateContent(entry, String(next || '').trim())}
            fullWidth
          />
        </div>
        <div className="UserLog__entryMeta">{timeAgo(entry.createdAt)}</div>
      </div>
    </div>
  );
};

EntryRow.propTypes = {
  entry: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    content: PropTypes.string,
    createdAt: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.instanceOf(Date)]).isRequired,
  }).isRequired,
  isCleaning: PropTypes.bool,
  onClean: PropTypes.func.isRequired,
  onUpdateContent: PropTypes.func.isRequired,
  formatHms: PropTypes.func.isRequired,
  timeAgo: PropTypes.func.isRequired,
  isLinked: PropTypes.bool,
  onOpenLinkedProject: PropTypes.func.isRequired,
};


