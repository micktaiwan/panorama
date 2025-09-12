import React, { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import './InlineEditable.css';

export const InlineEditable = ({ value, placeholder, onSubmit, as = 'input', startEditing = false, selectAllOnFocus = false, onContinue, rows = 4, options, className = '', inputClassName = '', fullWidth = false, submitOnEnter = true }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);
  const [openSelectOnMount, setOpenSelectOnMount] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (selectAllOnFocus && as !== 'select') {
      // Ensure selection after focus for input/textarea
      requestAnimationFrame(() => {
        if (typeof el.select === 'function') el.select();
      });
    }
    if (as === 'select' && openSelectOnMount) {
      // Open the native select as soon as it mounts
      requestAnimationFrame(() => {
        tryOpenNativePicker(el);
        setOpenSelectOnMount(false);
      });
    }
  }, [isEditing, selectAllOnFocus, as, openSelectOnMount]);

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  useEffect(() => {
    if (startEditing) {
      setIsEditing(true);
    }
  }, [startEditing]);

  const commit = (nextValue) => {
    const next = (typeof nextValue === 'string' ? nextValue : draft).trim();
    if (next !== (value || '')) {
      onSubmit(next);
    }
    setIsEditing(false);
  };

  const cancel = () => {
    setDraft(value || '');
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (!submitOnEnter) return;
    if (e.key === 'Enter') {
      if (as === 'textarea') {
        // Enter validates, Shift+Enter inserts a new line
        if (!e.shiftKey) {
          e.preventDefault();
          commit();
        }
      } else {
        e.preventDefault();
        if (e.shiftKey && typeof onContinue === 'function') {
          commit();
          onContinue();
        } else {
          commit();
        }
      }
    }
  };

  const tryOpenNativePicker = (el) => {
    if (!el) return false;
    el.focus();
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return true;
      } catch (err) {
        console.error('InlineEditable: showPicker failed', err);
      }
    }
    // Fallbacks
    el.click();
    const kd = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
    el.dispatchEvent(kd);
    return true;
  };

  const beginSelectEditingAndOpen = () => {
    flushSync(() => setIsEditing(true));
    const el = inputRef.current;
    if (el) {
      tryOpenNativePicker(el);
    } else {
      setOpenSelectOnMount(true);
    }
  };

  const normalizeOptions = () => {
    if (!options) return [];
    if (Array.isArray(options)) {
      return options.map(opt => {
        if (typeof opt === 'string') return { value: opt, label: opt };
        if (opt && typeof opt === 'object' && 'value' in opt) return { value: String(opt.value), label: opt.label || String(opt.value) };
        return { value: String(opt), label: String(opt) };
      });
    }
    return [];
  };

  const labelForValue = (val) => {
    const list = normalizeOptions();
    const found = list.find(o => o.value === String(val));
    return found ? found.label : (val || placeholder || '(empty)');
  };

  if (!isEditing) {
    const display = as === 'select'
      ? labelForValue(value)
      : (value && value.length > 0 ? value : (placeholder || '(empty)'));
    return (
      <span
        className={`inlineEditable${fullWidth ? ' fullWidth' : ''}${className ? ` ${className}` : ''}`}
        data-as={as}
        onPointerDown={(e) => {
          if (as !== 'select') return;
          e.preventDefault();
          beginSelectEditingAndOpen();
        }}
        onClick={() => {
          if (as !== 'select') setIsEditing(true);
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (as === 'select') beginSelectEditingAndOpen();
            else setIsEditing(true);
          }
        }}
      >
        <span className="inlineEditableContent">{display}</span>
      </span>
    );
  }

  if (as === 'select') {
    const list = normalizeOptions();
    return (
      <select
        className={`inlineEditableInput inlineEditableSelect${inputClassName ? ` ${inputClassName}` : ''}`}
        ref={inputRef}
        value={draft}
        onChange={e => {
          const nextVal = e.target.value;
          setDraft(nextVal);
          commit(nextVal);
        }}
        onBlur={() => commit()}
      >
        {list.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (as === 'textarea') {
    return (
      <textarea
        className={`inlineEditableInput${inputClassName ? ` ${inputClassName}` : ''}`}
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        rows={rows}
      />
    );
  }

  return (
    <input
      className={`inlineEditableInput${inputClassName ? ` ${inputClassName}` : ''}`}
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
    />
  );
};


