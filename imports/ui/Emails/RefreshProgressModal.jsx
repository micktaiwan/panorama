import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { RefreshProgressCollection } from '../../api/refreshProgress/collections';
import { Modal } from '../components/Modal/Modal.jsx';
import './RefreshProgressModal.css';

const STATUS_ICONS = {
  pending: '○',
  running: '●',
  done: '✓',
  error: '✕',
};

export const RefreshProgressModal = ({ open, onClose, steps }) => {
  useSubscribe('refreshProgress');
  const serverProgress = useFind(() => RefreshProgressCollection.find({}));

  // Merge server-side granular progress into client-side steps
  const mergedSteps = steps.map(step => {
    if (!step.key || step.status !== 'running') return step;
    const serverStep = serverProgress.find(sp => sp.stepKey === step.key);
    if (!serverStep) return step;
    return {
      ...step,
      detail: serverStep.detail || step.detail,
      current: serverStep.current,
      total: serverStep.total,
    };
  });

  const isRunning = mergedSteps.some(s => s.status === 'running');
  const doneCount = mergedSteps.filter(s => s.status === 'done' || s.status === 'error').length;
  const hasError = mergedSteps.some(s => s.status === 'error');

  // Compute progress: blend step completion with intra-step progress
  let progressPercent;
  const runningStep = mergedSteps.find(s => s.status === 'running');
  if (runningStep?.current && runningStep?.total) {
    const stepWeight = 1 / mergedSteps.length;
    const intraProgress = runningStep.current / runningStep.total;
    progressPercent = Math.round((doneCount + intraProgress) * stepWeight * 100);
  } else {
    progressPercent = Math.round((doneCount / mergedSteps.length) * 100);
  }

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
          {mergedSteps.map((step, i) => (
            <li key={i} className={`refreshStep ${step.status}`}>
              <span className="refreshStepIcon">{STATUS_ICONS[step.status]}</span>
              <span className="refreshStepLabel">{step.label}</span>
              {step.detail && <span className="refreshStepDetail">{step.detail}</span>}
              {step.status === 'running' && step.current !== undefined && step.current !== null && step.total !== undefined && step.total !== null && step.total > 0 && (
                <div className="refreshStepSubProgress">
                  <div
                    className="refreshStepSubProgressFill"
                    style={{ width: `${Math.round((step.current / step.total) * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
};
