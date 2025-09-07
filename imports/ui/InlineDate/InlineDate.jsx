import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import './InlineDate.css';
import { formatDate, deadlineSeverity } from '/imports/ui/utils/date.js';

const toInputValue = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
};

export const InlineDate = forwardRef(({ value, onSubmit, placeholder = 'No deadline' }, ref) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const startEdit = () => {
    setInputValue(toInputValue(value));
    setEditing(true);
  };
  useImperativeHandle(ref, () => ({
    open: () => startEdit(),
    close: () => setEditing(false)
  }));

  const commit = () => {
    const next = inputValue && inputValue.length > 0 ? inputValue : '';
    if (typeof onSubmit === 'function') onSubmit(next);
    setEditing(false);
  };

  if (!editing) {
    const sev = value ? deadlineSeverity(value) : '';
    const cls = ['deadlineDisplay'];
    if (value) {
      if (sev) cls.push(sev); else cls.push('dueLater');
    }
    return (
      <span className={cls.join(' ')} onClick={startEdit} role="button" tabIndex={0}>
        {value ? formatDate(value) : placeholder}
      </span>
    );
  }

  return (
    <span className="deadlineEditor">
      <input
        ref={inputRef}
        type="date"
        className="inlineEditableInput deadlineInput"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={commit}
      />
    </span>
  );
});


