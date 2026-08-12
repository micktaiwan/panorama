import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';

// The roster pulled from HR Tech. Always shown before being applied: the whole
// point of this screen is that a departure is a fact somebody sees, not a row
// that changes behind your back.
export const PeopleHrSyncModal = ({ preview, onClose, onApplied }) => {
  const [busy, setBusy] = useState(false);
  if (!preview) return null;

  const { marked = [], arrivals = [], created = [], conflicts = [], checked = 0 } = preview;
  const changes = marked.length + arrivals.length + created.length;
  const nothingToDo = changes === 0;

  const apply = () => {
    setBusy(true);
    Meteor.call('people.syncFromHrTech', { dryRun: false }, (err, res) => {
      setBusy(false);
      if (err) {
        notify({ message: `HR sync failed: ${err.message}`, kind: 'error' });
        return;
      }
      notify({
        message: `${res.marked.length} left · ${res.arrivals.length} arrival dates · ${res.created.length} created`,
        kind: 'success',
      });
      if (onApplied) onApplied(res);
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Departures from HR Tech"
      actions={[
        <button key="cancel" className="btn" onClick={onClose}>Cancel</button>,
        ...(nothingToDo ? [] : [
          <button key="apply" className="btn btn-primary ml8" disabled={busy} onClick={apply}>
            {busy ? 'Applying…' : `Apply ${changes} changes`}
          </button>
        ])
      ]}
    >
      <div>
        <p>{checked} people checked against the HR roster.</p>

        {nothingToDo && <p>Nothing to change — Panorama already matches.</p>}

        {marked.length > 0 && (
          <>
            <h4>To mark as left ({marked.length})</h4>
            <ul>
              {marked.map(m => (
                <li key={m.personId}>{m.name} — {m.leftAt || 'date unknown'}</li>
              ))}
            </ul>
          </>
        )}

        {arrivals.length > 0 && (
          <>
            <h4>Arrival dates to fill in ({arrivals.length})</h4>
            <ul>
              {arrivals.map(a => (
                <li key={a.personId}>{a.name} — {a.arrivalDate}</li>
              ))}
            </ul>
          </>
        )}

        {created.length > 0 && (
          <>
            <h4>To create ({created.length})</h4>
            <ul>
              {created.map(c => (
                <li key={c.email || c.name}>{c.name} {c.email ? `(${c.email})` : ''}</li>
              ))}
            </ul>
          </>
        )}

        {/* A disagreement is never resolved by the sync. One of the two systems
            is wrong and it is not for a script to decide which. */}
        {conflicts.length > 0 && (
          <>
            <h4>Disagreements, left untouched ({conflicts.length})</h4>
            <ul>
              {conflicts.map(c => (
                <li key={`${c.kind}-${c.personId}`}>
                  {c.kind === 'arrival'
                    ? `${c.name} — arrived ${c.here} here, ${c.sirh} per the SIRH`
                    : `${c.name} — marked as left here, still employed per the SIRH`}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
};

PeopleHrSyncModal.propTypes = {
  preview: PropTypes.object,
  onClose: PropTypes.func,
  onApplied: PropTypes.func,
};
