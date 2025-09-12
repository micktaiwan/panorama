import React, { useState } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { timeUntilPrecise, formatCompactDateTime } from '/imports/ui/utils/date.js';
import './Alarms.css';

export const Alarms = () => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [pomoMinutes, setPomoMinutes] = useState('5');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editRecurrence, setEditRecurrence] = useState('none');

  const ready = useTracker(() => Meteor.subscribe('alarms.mine').ready(), []);
  const alarms = useTracker(() => AlarmsCollection.find({}, { sort: { nextTriggerAt: 1 } }).fetch(), [ready]);
  // No local modal state; handled globally in App.jsx

  const handleCreate = (e) => {
    e.preventDefault();
    if (!date || !time || !title.trim()) return;
    const dt = new Date(`${date}T${time}:00`);
    Meteor.call('alarms.insert', {
      title: title.trim(),
      nextTriggerAt: dt,
      recurrence: { type: recurrence }
    }, (err) => {
      if (err) {
        console.error('alarms.insert failed', err);
        return;
      }
      setTitle(''); setDate(''); setTime(''); setRecurrence('none');
    });
  };

  const toggleEnabled = (a, enabled) => {
    const fields = { enabled };
    if (enabled) fields.done = false;
    Meteor.call('alarms.update', a._id, fields);
  };

  const toInputDate = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    const yyyy = x.getFullYear();
    const mm = String(x.getMonth() + 1).padStart(2, '0');
    const dd = String(x.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const toInputTime = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    const hh = String(x.getHours()).padStart(2, '0');
    const mi = String(x.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  };

  const onEditRow = (a) => {
    setEditingId(a._id);
    setEditTitle(a.title || '');
    const base = a.nextTriggerAt ? new Date(a.nextTriggerAt) : new Date();
    setEditDate(toInputDate(base));
    setEditTime(toInputTime(base));
    setEditRecurrence(a.recurrence?.type || 'none');
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditDate('');
    setEditTime('');
    setEditRecurrence('none');
  };

  const onSaveEdit = (a) => {
    if (!editingId) return;
    if (!editDate || !editTime || !editTitle.trim()) { onCancelEdit(); return; }
    const dt = new Date(`${editDate}T${editTime}:00`);
    Meteor.call('alarms.update', editingId, {
      title: editTitle.trim(),
      nextTriggerAt: dt,
      recurrence: { type: editRecurrence }
    }, () => {
      onCancelEdit();
    });
  };


  return (
    <div>
      <h2>Alarms</h2>
      <div className="testBar">
        <button
          className="btn btnSecondary"
          onClick={() => {
            const dt = new Date(Date.now() + 10000);
            Meteor.call('alarms.insert', {
              title: 'Test +10s',
              nextTriggerAt: dt,
              recurrence: { type: 'none' }
            }, (err) => {
              if (err) console.error('alarms.insert (+10s) failed', err);
            });
          }}
        >
          Test +10s
        </button>
        <span className="testHint">Creates a +10s one-off</span>
        <span className="dot">·</span>
        <label className="ml8" htmlFor="pomoSelect">Pomodoro</label>
        <select id="pomoSelect" className="afInput afSelect ml8" value={pomoMinutes} onChange={e => setPomoMinutes(e.target.value)}>
          <option value="5">5m</option>
          <option value="15">15m</option>
          <option value="30">30m</option>
          <option value="60">1h</option>
        </select>
        <button
          className="btn ml8"
          onClick={() => {
            const mins = parseInt(pomoMinutes, 10);
            const dt = new Date(Date.now() + mins * 60 * 1000);
            Meteor.call('alarms.insert', {
              title: 'Pomodoro',
              nextTriggerAt: dt,
              recurrence: { type: 'none' }
            }, (err) => {
              if (err) console.error('alarms.insert (pomodoro) failed', err);
            });
          }}
        >
          Start Pomodoro
        </button>
      </div>
      <form onSubmit={handleCreate} className="alarmsForm">
        <input className="afInput afTitle" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="afInput afDate" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <input className="afInput afTime" type="time" value={time} onChange={e => setTime(e.target.value)} />
        <select className="afInput afSelect" value={recurrence} onChange={e => setRecurrence(e.target.value)}>
          <option value="none">One-off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button className="btn afCreate" type="submit">Create</button>
      </form>
      <table className="table alarmsTable">
        <thead>
          <tr>
            <th className="colTitle">Title</th>
            <th className="colNext">Next</th>
            <th className="colRecurrence">Recurrence</th>
            <th className="colCenter">Enabled</th>
            <th className="colCenter">Done</th>
            <th className="colRight">Actions</th>
          </tr>
        </thead>
        <tbody>
          {alarms.map(a => (
            <tr key={a._id} className={(a.done || !a.enabled) ? 'rowDone' : ''}>
              <td className="colTitle" title={a.title}>
                {editingId === a._id ? (
                  <input className="afInput afTitle" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                ) : (
                  a.title
                )}
              </td>
              <td className="colNext">
                {editingId === a._id ? (
                  <span>
                    <input className="afInput afDate" type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                    <input className="afInput afTime" type="time" value={editTime} onChange={e => setEditTime(e.target.value)} />
                  </span>
                ) : (
                  a.snoozedUntilAt ? (
                    <span>
                      {formatCompactDateTime(a.snoozedUntilAt)} <span className="timeAgoHighlight">({timeUntilPrecise(a.snoozedUntilAt)})</span> — original: {formatCompactDateTime(a.nextTriggerAt)}
                    </span>
                  ) : (
                    <span>
                      {formatCompactDateTime(a.nextTriggerAt)} <span className="timeAgoHighlight">({timeUntilPrecise(a.nextTriggerAt)})</span>
                    </span>
                  )
                )}
              </td>
              <td className="colRecurrence">
                {editingId === a._id ? (
                  <select className="afInput afSelect" value={editRecurrence} onChange={e => setEditRecurrence(e.target.value)}>
                    <option value="none">One-off</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                ) : (
                  a.recurrence?.type || 'none'
                )}
              </td>
              <td className="colCenter">
                <input type="checkbox" checked={!!a.enabled} onChange={e => toggleEnabled(a, e.target.checked)} />
              </td>
              <td className="colCenter">
                {a.done ? (
                  <span className={`badge badgeSuccess`}>Done</span>
                ) : (
                  <span className={`badge badgeMuted`}>Pending</span>
                )}
              </td>
              <td className="colRight">
                <div className="rowActions">
                  {editingId === a._id ? (
                    <>
                      <button className="btn" onClick={() => onSaveEdit(a)}>Save</button>
                      <button className="btn btnSecondary" onClick={onCancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btnSecondary" onClick={() => onEditRow(a)}>Edit</button>
                      <button className="btn btnSecondary" onClick={() => Meteor.call('alarms.snooze', a._id, 5)}>Snooze +5m</button>
                      <button className="btn" onClick={() => Meteor.call('alarms.remove', a._id)}>Delete</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};


