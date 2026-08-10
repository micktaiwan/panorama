import React from 'react';
import PropTypes from 'prop-types';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
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
      <Tooltip content={isCleaning ? 'Fixing…' : 'Fix spelling (AI)'}>
        <button
          className="iconButton UserLog__action"
          disabled={!!isCleaning}
          onClick={() => onClean(entry)}
          aria-label={isCleaning ? 'Fixing' : 'Fix this line'}
        >{isCleaning ? '⏳' : '🪄'}</button>
      </Tooltip>
      <div className="UserLog__entryBody">
        <div className="UserLog__entryClock">
          {formatHms(entry.createdAt)}
          {isLinked ? (
            <Tooltip content="Open project for linked task">
              <button
                type="button"
                className="UserLog__linkedIcon"
                aria-label="Open project for linked task"
                onClick={() => onOpenLinkedProject(entry)}
              >🔗</button>
            </Tooltip>
          ) : null}
        </div>
        <div className="UserLog__entryText">
          <InlineEditable
            value={entry.content || ''}
            placeholder="(empty)"
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


