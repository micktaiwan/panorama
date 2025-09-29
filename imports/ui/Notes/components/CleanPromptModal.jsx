import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';

export const CleanPromptModal = ({ 
  open, 
  onClose, 
  onConfirm, 
  defaultPrompt = '',
  noteContent = '' 
}) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);

  // Load last custom prompt from localStorage when modal opens
  useEffect(() => {
    if (open) {
      const lastCustomPrompt = typeof window !== 'undefined' ? 
        localStorage.getItem('notes.lastCustomCleanPrompt') : null;
      
      if (lastCustomPrompt) {
        setCustomPrompt(lastCustomPrompt);
        setUseCustomPrompt(true);
      } else {
        setCustomPrompt('');
        setUseCustomPrompt(false);
      }
    }
  }, [open]);

  const handleConfirm = () => {
    const promptToUse = useCustomPrompt && customPrompt.trim() ? customPrompt.trim() : defaultPrompt;
    
    // Save custom prompt to localStorage if it was used
    if (useCustomPrompt && customPrompt.trim()) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('notes.lastCustomCleanPrompt', customPrompt.trim());
      }
    }
    
    onConfirm(promptToUse);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize Clean Prompt"
      icon="🧹"
      className="wide"
      actions={[
        <button key="cancel" className="btn" onClick={handleCancel}>
          Cancel
        </button>,
        <button key="confirm" className="btn primary ml8" onClick={handleConfirm}>
          Clean Note
        </button>
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label htmlFor="custom-prompt-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <input
              id="custom-prompt-checkbox"
              type="checkbox"
              checked={useCustomPrompt}
              onChange={(e) => setUseCustomPrompt(e.target.checked)}
            />
            <span>Use custom prompt instead of default</span>
          </label>
        </div>

        <div>
          <label htmlFor="custom-prompt-textarea" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Custom Clean Instructions:
          </label>
          <textarea
            id="custom-prompt-textarea"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Enter your custom cleaning instructions..."
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--panel)',
              color: 'inherit',
              fontFamily: 'inherit',
              fontSize: '14px',
              resize: 'vertical'
            }}
            disabled={!useCustomPrompt}
          />
        </div>

        <div>
          <label htmlFor="default-prompt-display" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Default Clean Instructions:
          </label>
          <div
            id="default-prompt-display"
            style={{
              padding: '12px',
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: '200px',
              overflow: 'auto'
            }}
          >
            {defaultPrompt}
          </div>
        </div>

        {noteContent && (
          <div>
            <label htmlFor="note-preview-display" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Note Preview (first 200 characters):
            </label>
            <div
              id="note-preview-display"
              style={{
                padding: '12px',
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                maxHeight: '100px',
                overflow: 'auto'
              }}
            >
              {noteContent.length > 200 ? `${noteContent.substring(0, 200)}...` : noteContent}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

CleanPromptModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  defaultPrompt: PropTypes.string,
  noteContent: PropTypes.string
};
