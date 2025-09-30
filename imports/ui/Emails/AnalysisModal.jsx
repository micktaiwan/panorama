import React, { useEffect } from 'react';

export const AnalysisModal = ({ modal, onClose, formatDate }) => {
  const { message, analysis, loading, error } = modal;

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalContent analysisModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>Email Analysis</h3>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody">
          <div className="analysisEmailInfo">
            <div className="analysisEmailMeta">
              <div><strong>From:</strong> {message.from || 'Unknown'}</div>
              <div><strong>Subject:</strong> {message.subject || 'No subject'}</div>
              <div><strong>Date:</strong> {formatDate(message.gmailDate)}</div>
            </div>
          </div>
          
          <div className="analysisContent">
            {loading && (
              <div className="analysisLoading">
                <div className="loadingSpinner"></div>
                <p>Analyzing email with AI...</p>
              </div>
            )}
            
            {error && (
              <div className="analysisError">
                <h4>Analysis Failed</h4>
                <p>{error}</p>
              </div>
            )}
            
            {analysis && (
              <div className="analysisResult">
                <h4>AI Analysis Summary</h4>
                <div className="analysisText">
                  {analysis.summary}
                </div>
                <div className="analysisTimestamp">
                  <small>Analyzed at: {formatDate(analysis.timestamp)}</small>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modalFooter">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
