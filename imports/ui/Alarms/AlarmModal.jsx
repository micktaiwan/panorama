import React from 'react';
import PropTypes from 'prop-types';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';
import { formatDateTime } from '/imports/ui/utils/date.js';

export const AlarmModal = ({ open = false, alarm = null, onClose, onBeforeAction } = {}) => {
  const title = alarm ? String(alarm?.title || '') : 'Alarm';
  const body = (() => {
    if (!alarm) return null;
    if (alarm.snoozedUntilAt) {
      return (
        <div>Now snoozed until: {new Date(alarm.snoozedUntilAt).toLocaleString()} — original: {new Date(alarm.nextTriggerAt).toLocaleString()}</div>
      );
    }
    return (
      <div>Scheduled: {new Date(alarm.nextTriggerAt).toLocaleString()}</div>
    );
  })();

  const handleSnooze = (mins) => {
    const id = alarm?._id;
    if (!id || !Number.isFinite(mins)) return;
    onBeforeAction?.(id);
    const until = new Date(Date.now() + mins * 60000);
    Meteor.call('alarms.snooze', id, mins, (err) => {
      if (err) {
        notify({ message: 'Snooze failed', kind: 'error' });
      } else {
        notify({ message: `Alarm snoozed until ${formatDateTime(until)}`, kind: 'success' });
      }
      onClose?.();
    });
  };

  const handleDismiss = () => {
    const id = alarm?._id;
    if (!id) return;
    onBeforeAction?.(id);
    Meteor.call('alarms.dismiss', id, (err) => {
      if (err) {
        notify({ message: 'Dismiss failed', kind: 'error' });
      } else {
        notify({ message: 'Alarm dismissed', kind: 'info' });
      }
      onClose?.();
    });
  };

  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title={title}
      icon={<span>🔔</span>}
      actions={[
        <button key="s5" className="btn" onClick={() => handleSnooze(5)}>Snooze +5m</button>,
        <button key="s15" className="btn ml8" onClick={() => handleSnooze(15)}>+15m</button>,
        <button key="s60" className="btn ml8" onClick={() => handleSnooze(60)}>+1h</button>,
        <button key="dismiss" className="btn ml8" onClick={handleDismiss}>Dismiss</button>
      ]}
    >
      {body}
    </Modal>
  );
};

export default AlarmModal;

AlarmModal.propTypes = {
  open: PropTypes.bool,
  alarm: PropTypes.shape({
    _id: PropTypes.string,
    title: PropTypes.string,
    snoozedUntilAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    nextTriggerAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)])
  }),
  onClose: PropTypes.func,
  onBeforeAction: PropTypes.func
};

 


