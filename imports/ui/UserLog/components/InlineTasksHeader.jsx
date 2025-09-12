import React from 'react';
import PropTypes from 'prop-types';

export function InlineTasksHeader({ hideExisting, onToggleHideExisting, onCreateAll, visibleCount }) {
  return (
    <div className="UserLog__inlineTasksTitle">
      Task suggestions
      <label className="ml8" htmlFor="ul_hide_existing">
        <input
          id="ul_hide_existing"
          type="checkbox"
          checked={hideExisting}
          onChange={(e) => onToggleHideExisting(!!e.target.checked)}
        /> Hide existing
      </label>
      <button className="btn btn-xs ml8" onClick={onCreateAll} disabled={!visibleCount}>
        {visibleCount ? `Create all (${visibleCount})` : 'Create all'}
      </button>
    </div>
  );
}

InlineTasksHeader.propTypes = {
  hideExisting: PropTypes.bool.isRequired,
  onToggleHideExisting: PropTypes.func.isRequired,
  onCreateAll: PropTypes.func.isRequired,
  visibleCount: PropTypes.number,
};


