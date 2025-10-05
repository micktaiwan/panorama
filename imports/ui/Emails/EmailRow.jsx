import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '../utils/notify.js';

// Helper function to extract sender name from email address
const extractSenderName = (from) => {
  if (!from) return 'Unknown';
  
  // Check if it's in format "Name <email@domain.com>"
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return match[1].trim();
  }
  
  // If it's just an email address, extract the part before @
  if (from.includes('@')) {
    return from.split('@')[0];
  }
  
  // Return as is if no email format detected
  return from;
};

export const EmailRow = ({ message, threadCount, onOpen, onArchive, onDelete, onAddLabel, onAnalyze, labels, formatDate, isSelected = false }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Use stored data from database - no API calls needed
  const from = message.from || '';
  const subject = message.subject || '';
  const snippet = message.snippet || '';
  const gmailDate = message.gmailDate || new Date();
  // Extract sender name only
  const senderName = extractSenderName(from);

  const handleRowClick = (e) => {
    // Don't open if clicking on action buttons
    if (e.target.closest('.emailActions') || e.target.closest('.ctaSection')) {
      return;
    }
    onOpen(message.id);
  };

  const handleSuggestedAction = () => {
    if (!message.ctaSuggestion) return;
    handleAction(message.ctaSuggestion.action);
  };

  const handleAction = (action) => {
    if (isProcessing) return;

    setIsProcessing(true);
    setShowDropdown(false);

    try {
      switch (action) {
        case 'delete':
          // Use optimistic UI callback - no await, instant UI update
          onDelete(message.id);
          break;
        case 'archive':
          // Use optimistic UI callback - no await, instant UI update
          onArchive(message.id);
          break;
        case 'reply':
          // Reply doesn't need optimistic UI, keep direct API call
          Meteor.callAsync('emails.markReply', message._id)
            .then((result) => {
              notify('Email marked for reply', 'success');
              // Open Gmail thread in new tab
              if (result.threadUrl) {
                window.open(result.threadUrl, '_blank');
              }
            })
            .catch((error) => {
              console.error('Error marking reply:', error);
              notify(`Error: ${error.message}`, 'error');
            });
          break;
        default:
          throw new Error('Unknown action');
      }
    } catch (error) {
      console.error('Error executing action:', error);
      notify(`Error: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const getActionButtonClass = (action) => {
    switch (action) {
      case 'delete': return 'ctaButtonDanger';
      case 'archive': return 'ctaButtonSuccess';
      case 'reply': return 'ctaButtonPrimary';
      default: return 'ctaButtonSecondary';
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'delete': return '🗑️';
      case 'archive': return '📁';
      case 'reply': return '↩️';
      default: return '❓';
    }
  };

  const getConfidenceClass = (confidence) => {
    if (confidence >= 0.8) return 'confidenceHigh';
    if (confidence >= 0.6) return 'confidenceMedium';
    return 'confidenceLow';
  };

  // Check if email is unread
  const isUnread = (message.labelIds || []).includes('UNREAD');

  return (
    <div className={`emailRow clickable ${isUnread ? 'unread' : 'read'} ${isSelected ? 'selected' : ''}`} onClick={handleRowClick}>
      <div className="emailContent">
        <span className="emailFrom">{senderName}</span>
        <span className="emailSubject">
          {threadCount > 1 && <span className="conversationIndicator">📧</span>}
          {subject}
        </span>
        <span className="emailSnippet">{snippet}</span>
        {threadCount > 1 && (
          <span 
            className="threadCount" 
            title={`Conversation with ${threadCount} messages`}
          >
            <span className="threadIcon">💬</span>
            {threadCount}
          </span>
        )}
        <span className="emailDate">{formatDate(gmailDate)}</span>
      </div>
      <div className="emailActions">
        {/* CTA Section - only show if suggestion is available */}
        {message.ctaPrepared && message.ctaSuggestion && (
          <div className="ctaSection">
            {/* Main suggested action button */}
            <button
              className={`ctaButton ${getActionButtonClass(message.ctaSuggestion.action)}`}
              onClick={handleSuggestedAction}
              disabled={isProcessing}
              title={`AI suggests: ${message.ctaSuggestion.rationale} (${Math.round(message.ctaSuggestion.confidence * 100)}% confidence)`}
            >
              {getActionIcon(message.ctaSuggestion.action)}
              {message.ctaSuggestion.action.charAt(0).toUpperCase() + message.ctaSuggestion.action.slice(1)}
              <span className={`confidenceScore ${getConfidenceClass(message.ctaSuggestion.confidence)}`}>
                ({Math.round(message.ctaSuggestion.confidence * 100)}%)
              </span>
            </button>

            {/* Dropdown for other actions */}
            <div className="ctaDropdown">
              <button
                className="ctaDropdownButton"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isProcessing}
              >
                ⋯
              </button>
              {showDropdown && (
                <div className="ctaDropdownMenu">
                  {['delete', 'archive', 'reply'].map(action => (
                    <div
                      key={action}
                      className={`ctaDropdownItem ${action === 'delete' ? 'danger' : action === 'archive' ? 'success' : 'primary'}`}
                      onClick={() => handleAction(action)}
                    >
                      {getActionIcon(action)}
                      {action.charAt(0).toUpperCase() + action.slice(1)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tooltip with rationale */}
            <div className="tooltip">
              <span>ℹ️</span>
              <div className="tooltipContent">
                <strong>AI Suggestion:</strong> {message.ctaSuggestion.rationale}
                <br />
                <strong>Confidence:</strong> {Math.round(message.ctaSuggestion.confidence * 100)}%
                <br />
                <strong>Model:</strong> {message.ctaSuggestion.model}
              </div>
            </div>
          </div>
        )}

        {/* Original action buttons */}
        <button 
          className="btn btn-sm btn-analyze" 
          onClick={() => onAnalyze({ message })}
        >
          Analyse
        </button>
      </div>
    </div>
  );
};
