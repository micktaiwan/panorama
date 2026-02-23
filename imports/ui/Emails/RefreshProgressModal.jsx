import React from 'react';
import { Modal } from '../components/Modal/Modal.jsx';
import './RefreshProgressModal.css';

const STATUS_ICONS = {
  pending: '○',
  running: '●',
  done: '✓',
  error: '✕',
};

export const RefreshProgressModal = ({ open, onClose, steps }) => {
  const isRunning = steps.some(s => s.status === 'running');
  const doneCount = steps.filter(s => s.status === 'done' || s.status === 'error').length;
  const progressPercent = Math.round((doneCount / steps.length) * 100);
  const hasError = steps.some(s => s.status === 'error');

  return (
    <Modal
      open={open}
      onClose={isRunning ? undefined : onClose}
      title="Refreshing emails"
      icon="↻"
      closable={!isRunning}
      actions={!isRunning ? [
        <button key="close" className="btn btn-primary" onClick={onClose}>Close</button>
      ] : undefined}
    >
      <div className="refreshProgress">
        <div className="refreshProgressBar">
          <div
            className={`refreshProgressFill ${hasError ? 'error' : ''}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <ul className="refreshSteps">
          {steps.map((step, i) => (
            <li key={i} className={`refreshStep ${step.status}`}>
              <span className="refreshStepIcon">{STATUS_ICONS[step.status]}</span>
              <span className="refreshStepLabel">{step.label}</span>
              {step.detail && <span className="refreshStepDetail">{step.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
};
