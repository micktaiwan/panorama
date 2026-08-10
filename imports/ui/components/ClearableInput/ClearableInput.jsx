import React, { useRef } from 'react';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import './ClearableInput.css';

/**
 * Text input (or textarea with `multiline`) with a one-click clear button,
 * shown only when there is content.
 * `icon` is rendered as-is before the field (positioning is up to the caller's CSS).
 * `fill` makes the wrapper stretch inside a flex/grid parent instead of hugging its content.
 */
export const ClearableInput = ({
  value,
  onChange,
  onClear = null,
  className = '',
  wrapClassName = '',
  icon = null,
  clearLabel = 'Clear',
  inputRef = null,
  multiline = false,
  fill = false,
  ...fieldProps
}) => {
  const localRef = useRef(null);
  const ref = inputRef ?? localRef;
  const hasValue = String(value ?? '').length > 0;
  const Field = multiline ? 'textarea' : 'input';

  const handleClear = () => {
    onChange('');
    if (typeof onClear === 'function') onClear();
    ref.current?.focus();
  };

  const wrapClasses = [
    'clearableInput',
    multiline ? 'clearableInput--multiline' : '',
    fill ? 'clearableInput--fill' : '',
    wrapClassName,
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapClasses}>
      {icon}
      <Field
        ref={ref}
        className={`clearableInputField ${className}`.trim()}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...fieldProps}
      />
      {hasValue ? (
        <Tooltip content={clearLabel} className="clearableInputClearTip">
          <button
            type="button"
            className="clearableInputClear"
            aria-label={clearLabel}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
};
