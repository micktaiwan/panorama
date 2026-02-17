import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { GmailMessagesCollection } from '../../api/emails/collections';
import { notify } from '../utils/notify.js';
import './InboxZero.css';

export const InboxZero = () => {
  const [currentEmailIndex, setCurrentEmailIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedEmails, setProcessedEmails] = useState(new Set());
  const [lastAction, setLastAction] = useState(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [sessionStartTime, _setSessionStartTime] = useState(Date.now());

  // ✅ Solution 3 : Utiliser la publication réactive
  const subInboxZeroThreads = useSubscribe('emails.inboxZeroThreads');
  const allMessages = useFind(() => GmailMessagesCollection.find({}, { 
    sort: { gmailDate: -1 } 
  }));

  // Group messages by threadId to get complete thread context
  const eligibleEmails = useMemo(() => {
    // Group all messages by threadId
    const threadMap = new Map();
    
    allMessages.forEach(message => {
      const threadId = message.threadId;
      if (!threadId) return; // Skip messages without threadId
      
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId).push(message);
    });
    
    // For each thread, find the most recent INBOX message
    const threadRepresentatives = [];
    
    threadMap.forEach((threadMessages, threadId) => {
      // Sort messages in thread by date (most recent first)
      const sortedMessages = threadMessages.toSorted((a, b) => 
        new Date(b.gmailDate) - new Date(a.gmailDate)
      );
      
      // Find the most recent message that is in INBOX and not in TRASH
      const inboxMessage = sortedMessages.find(message => 
        message.labelIds?.includes('INBOX') && 
        !message.labelIds?.includes('TRASH')
      );
      
      if (inboxMessage) {
        // Add thread context information
        threadRepresentatives.push({
          ...inboxMessage,
          threadId: threadId,
          threadTotalCount: threadMessages.length,
          threadInboxCount: threadMessages.filter(msg => 
            msg.labelIds?.includes('INBOX') && 
            !msg.labelIds?.includes('TRASH')
          ).length,
          threadArchivedCount: threadMessages.filter(msg => 
            !msg.labelIds?.includes('INBOX') && 
            !msg.labelIds?.includes('TRASH')
          ).length,
          threadTrashCount: threadMessages.filter(msg => 
            msg.labelIds?.includes('TRASH')
          ).length,
          threadContext: {
            hasArchivedMessages: threadMessages.some(msg => 
              !msg.labelIds?.includes('INBOX') && 
              !msg.labelIds?.includes('TRASH')
            ),
            hasTrashMessages: threadMessages.some(msg => 
              msg.labelIds?.includes('TRASH')
            ),
            isMultiMessageThread: threadMessages.length > 1
          }
        });
      }
    });
    
    // Sort by the most recent message date in each thread
    return threadRepresentatives.toSorted((a, b) => 
      new Date(b.gmailDate) - new Date(a.gmailDate)
    );
  }, [allMessages]);

  // Filter out processed emails for display
  const visibleEmails = useMemo(() => {
    return eligibleEmails.filter(email => !processedEmails.has(email._id));
  }, [eligibleEmails, processedEmails]);

  const currentEmail = visibleEmails[currentEmailIndex];

  // Keyboard shortcuts
  const handleKeyPress = useCallback((event) => {
    if (isProcessing || !currentEmail) return;

    switch (event.key.toLowerCase()) {
      case 'enter':
        event.preventDefault();
        handleSuggestedAction();
        break;
      case 'd':
        event.preventDefault();
        handleAction('delete');
        break;
      case 'e':
        event.preventDefault();
        handleAction('archive');
        break;
      case 'r':
        event.preventDefault();
        handleAction('reply');
        break;
      case 'arrowright':
      case 'arrowdown':
        event.preventDefault();
        nextEmail();
        break;
      case 'arrowleft':
      case 'arrowup':
        event.preventDefault();
        previousEmail();
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmail, isProcessing]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // ✅ Solution 3 : Plus besoin d'effet complexe, la méthode côté serveur gère tout

  const handleSuggestedAction = () => {
    if (!currentEmail?.ctaSuggestion) return;
    handleAction(currentEmail.ctaSuggestion.action);
  };

  // Optimistic UI functions
  const handleDeleteEmail = (emailId) => {
    // Immediately mark as processed and move to next
    setProcessedEmails(prev => new Set([...prev, emailId]));
    setProcessedCount(prev => prev + 1);
    setLastAction({ type: 'delete', message: 'Email moved to trash' });
    notify('Email moved to trash', 'success');
    moveToNextEmail();
    
    // Call API in background
    Meteor.callAsync('emails.moveToTrash', emailId)
      .catch((error) => {
        console.error('Failed to delete email:', error);
        // Revert optimistic UI on error
        setProcessedEmails(prev => {
          const newSet = new Set(prev);
          newSet.delete(emailId);
          return newSet;
        });
        notify(`Failed to delete: ${error.message}`, 'error');
      });
  };

  const handleArchiveEmail = (emailId) => {
    // Immediately mark as processed and move to next
    setProcessedEmails(prev => new Set([...prev, emailId]));
    setProcessedCount(prev => prev + 1);
    setLastAction({ type: 'archive', message: 'Email archived' });
    notify('Email archived', 'success');
    moveToNextEmail();
    
    // Call API in background
    Meteor.callAsync('emails.archive', emailId)
      .catch((error) => {
        console.error('Failed to archive email:', error);
        // Revert optimistic UI on error
        setProcessedEmails(prev => {
          const newSet = new Set(prev);
          newSet.delete(emailId);
          return newSet;
        });
        notify(`Failed to archive: ${error.message}`, 'error');
      });
  };

  const handleReplyEmail = (emailId) => {
    // Reply doesn't remove from inbox, so no optimistic UI needed
    Meteor.callAsync('emails.markReply', emailId)
      .then((result) => {
        notify('Email marked for reply', 'success');
        // Open Gmail thread in new tab
        if (result.threadUrl) {
          window.open(result.threadUrl, '_blank');
        }
      })
      .catch((error) => {
        console.error('Failed to mark reply:', error);
        notify(`Failed to mark reply: ${error.message}`, 'error');
      });
  };

  const moveToNextEmail = () => {
    setCurrentEmailIndex(prev => {
      const nextIndex = prev + 1;
      return nextIndex < visibleEmails.length ? nextIndex : 0; // Loop back to start
    });
  };

  const handleAction = (action) => {
    if (!currentEmail || isProcessing) return;

    setIsProcessing(true);
    setShowDropdown(false);

    try {
      switch (action) {
        case 'delete':
          handleDeleteEmail(currentEmail._id);
          break;
        case 'archive':
          handleArchiveEmail(currentEmail._id);
          break;
        case 'reply':
          handleReplyEmail(currentEmail._id);
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

  const nextEmail = () => {
    if (currentEmailIndex < visibleEmails.length - 1) {
      setCurrentEmailIndex(currentEmailIndex + 1);
    }
  };

  const previousEmail = () => {
    if (currentEmailIndex > 0) {
      setCurrentEmailIndex(currentEmailIndex - 1);
    }
  };

  const refreshEmails = () => {
    setCurrentEmailIndex(0);
    setProcessedEmails(new Set());
    // ✅ Solution 3 : Plus besoin de recharger, la publication est réactive !
  };

  // Reset index when visible emails change
  useEffect(() => {
    if (currentEmailIndex >= visibleEmails.length && visibleEmails.length > 0) {
      setCurrentEmailIndex(0);
    }
  }, [visibleEmails.length, currentEmailIndex]);

  // Clear last action after 2 seconds
  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => {
        setLastAction(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  const getActionButtonClass = (action) => {
    switch (action) {
      case 'delete': return 'inboxZero-ctaButtonDanger';
      case 'archive': return 'inboxZero-ctaButtonSuccess';
      case 'reply': return 'inboxZero-ctaButtonPrimary';
      default: return 'inboxZero-ctaButtonSecondary';
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
    if (confidence >= 0.8) return 'inboxZero-confidenceHigh';
    if (confidence >= 0.6) return 'inboxZero-confidenceMedium';
    return 'inboxZero-confidenceLow';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ✅ Solution 3 : Gestion des états de chargement avec publication
  if (subInboxZeroThreads()) {
    return (
      <div className="inboxZero-container">
        <div className="inboxZero-loadingState">
          <div className="inboxZero-loadingSpinner"></div>
          Loading emails...
        </div>
      </div>
    );
  }

  if (visibleEmails.length === 0) {
    return (
      <div className="inboxZero-container">
        <div className="inboxZero-header">
          <h1 className="inboxZero-title">Inbox Zero</h1>
          <p className="inboxZero-subtitle">Achieve inbox zero with AI-powered suggestions</p>
        </div>
        
        <div className="inboxZero-emptyState">
          <div className="inboxZero-emptyStateIcon">📧</div>
          <h2 className="inboxZero-emptyStateTitle">No emails in inbox</h2>
          <p className="inboxZero-emptyStateMessage">Your inbox is empty! Great job maintaining inbox zero.</p>
          <button className="inboxZero-refreshButton" onClick={refreshEmails}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  if (!currentEmail) {
    return (
      <div className="inboxZero-container">
        <div className="inboxZero-loadingState">
          <div className="inboxZero-loadingSpinner"></div>
          Loading emails...
        </div>
      </div>
    );
  }

  return (
    <div className="inboxZero-container">
      <div className="inboxZero-header">
        <h1 className="inboxZero-title">Inbox Zero</h1>
        <p className="inboxZero-subtitle">
          Email {currentEmailIndex + 1} of {visibleEmails.length}
          {currentEmail?.threadTotalCount && currentEmail.threadTotalCount > 1 && (
            <span className="inboxZero-threadInfo">
              • Thread: {currentEmail.threadInboxCount}/{currentEmail.threadTotalCount} messages
            </span>
          )}
        </p>
        {lastAction && (
          <div className="inboxZero-lastAction">
            ✅ {lastAction.message}
          </div>
        )}
        {processedCount > 0 && (
          <div className="inboxZero-stats">
            <span className="inboxZero-processedCount">
              {processedCount} email{processedCount > 1 ? 's' : ''} processed
            </span>
            <span className="inboxZero-speed">
              • {Math.round(processedCount / ((Date.now() - sessionStartTime) / 60000))} emails/min
            </span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="inboxZero-progressBar">
        <div 
          className="inboxZero-progressFill" 
          style={{ '--progress-width': `${((currentEmailIndex + 1) / visibleEmails.length) * 100}%` }}
        />
      </div>

      <div className="inboxZero-emailCard">
        <div className="inboxZero-emailHeader">
          <h2 className="inboxZero-emailSubject">{currentEmail.subject || 'No Subject'}</h2>
          <div className="inboxZero-emailMeta">
            <span className="inboxZero-emailFrom">{currentEmail.from || 'Unknown Sender'}</span>
            <span className="inboxZero-emailDate">{formatDate(currentEmail.gmailDate)}</span>
          </div>
        </div>

        <div className="inboxZero-emailBody">
          {currentEmail.snippet && (
            <div className="inboxZero-emailSnippet">
              {currentEmail.snippet}
            </div>
          )}
          {currentEmail.bodyPreview && (
            <div className="inboxZero-emailBodyPreview">
              {currentEmail.bodyPreview.substring(0, 1000)}
              {currentEmail.bodyPreview.length > 1000 && '...'}
            </div>
          )}
        </div>

        <div className="inboxZero-ctaSection">
          {currentEmail.ctaPrepared && currentEmail.ctaSuggestion ? (
            <>
              {/* Main suggested action button */}
              <button
                className={`inboxZero-ctaButton ${getActionButtonClass(currentEmail.ctaSuggestion.action)}`}
                onClick={handleSuggestedAction}
                disabled={isProcessing}
              >
                {getActionIcon(currentEmail.ctaSuggestion.action)}
                {currentEmail.ctaSuggestion.action.charAt(0).toUpperCase() + currentEmail.ctaSuggestion.action.slice(1)}
                <span className={`inboxZero-confidenceScore ${getConfidenceClass(currentEmail.ctaSuggestion.confidence)}`}>
                  ({Math.round(currentEmail.ctaSuggestion.confidence * 100)}%)
                </span>
              </button>

              {/* Dropdown for other actions */}
              <div className="inboxZero-ctaDropdown">
                <button
                  className="inboxZero-ctaDropdownButton"
                  onClick={() => setShowDropdown(!showDropdown)}
                  disabled={isProcessing}
                >
                  ⋯
                </button>
                {showDropdown && (
                  <div className="inboxZero-ctaDropdownMenu">
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
              <div className="inboxZero-tooltip">
                <span>ℹ️</span>
                <div className="inboxZero-tooltipContent">
                  <strong>AI Suggestion:</strong> {currentEmail.ctaSuggestion.rationale}
                  <br />
                  <strong>Confidence:</strong> {Math.round(currentEmail.ctaSuggestion.confidence * 100)}%
                  <br />
                  <strong>Model:</strong> {currentEmail.ctaSuggestion.model}
                </div>
              </div>
            </>
          ) : currentEmail.ctaPreparing ? (
            <div className="inboxZero-loadingState">
              <div className="inboxZero-loadingSpinner"></div>
              Analyzing email...
            </div>
          ) : (
            <div className="inboxZero-loadingState">
              <div className="inboxZero-loadingSpinner"></div>
              Analyze in progress...
              <br />
              <button className="inboxZero-refreshButton inboxZero-refreshButton--topMargin" onClick={refreshEmails}>
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="inboxZero-shortcuts">
        <div className="inboxZero-shortcutsTitle">Shortcuts</div>
        <div className="inboxZero-shortcut">
          <span>Enter</span>
          <span className="inboxZero-shortcutKey">Execute suggestion</span>
        </div>
        <div className="inboxZero-shortcut">
          <span>D</span>
          <span className="inboxZero-shortcutKey">Delete</span>
        </div>
        <div className="inboxZero-shortcut">
          <span>E</span>
          <span className="inboxZero-shortcutKey">Archive</span>
        </div>
        <div className="inboxZero-shortcut">
          <span>R</span>
          <span className="inboxZero-shortcutKey">Reply</span>
        </div>
        <div className="inboxZero-shortcut">
          <span>←/→</span>
          <span className="inboxZero-shortcutKey">Navigate</span>
        </div>
      </div>
    </div>
  );
};
