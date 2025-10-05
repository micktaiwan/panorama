import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection } from '../../api/emails/collections';
import { Card } from '../components/Card/Card.jsx';
import { notify } from '../utils/notify.js';
import { MessageModal } from './MessageModal.jsx';
import { EmailRow } from './EmailRow.jsx';
import { AnalysisModal } from './AnalysisModal.jsx';
import { EmailsToolbar } from './EmailsToolbar.jsx';
import { ApiStats } from './ApiStats.jsx';
import { navigateTo } from '../router.js';
import './EmailsPage.css';


export const EmailsPage = () => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingLabels, setIsSyncingLabels] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFromGmail, setSearchFromGmail] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [apiStats, setApiStats] = useState(null);
  const [emailStats, setEmailStats] = useState(null);
  const [ctaStats, setCtaStats] = useState(null);
  const [showApiStats, setShowApiStats] = useState(false);
  const [analysisModal, setAnalysisModal] = useState(null);
  const [archivedMessages, setArchivedMessages] = useState(new Set());
  const [deletedMessages, setDeletedMessages] = useState(new Set());
  const [locallyArchivedMessages, setLocallyArchivedMessages] = useState(new Set());
  const [messages, setMessages] = useState([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const subTokens = useSubscribe('gmail.tokens');
  const tokens = useFind(() => GmailTokensCollection.find({}))[0];
  

  const isConnected = !!tokens?.access_token;

  // ✅ Fonction pour charger les threads avec contexte complet
  const loadEmailsPageThreads = useCallback(async () => {
    if (!isConnected) return;
    
    try {
      setIsLoadingThreads(true);
      const result = await Meteor.callAsync('emails.getEmailsPageThreads');
      
      console.log('[EMAILS PAGE] Loaded threads:', result);
      setMessages(result.threads || []);
      
    } catch (error) {
      console.error('[EMAILS PAGE] Failed to load threads:', error);
      notify({ message: `Failed to load emails: ${error.message}`, kind: 'error' });
    } finally {
      setIsLoadingThreads(false);
    }
  }, [isConnected]);

  // Load threads when connected
  useEffect(() => {
    if (isConnected) {
      loadEmailsPageThreads();
    }
  }, [isConnected, loadEmailsPageThreads]);

  // Filter messages based on search query and exclude locally archived/deleted messages
  const filteredMessages = useMemo(() => {
    // Filter out locally archived and deleted messages
    const visibleMessages = messages.filter(thread => {
      const messageId = thread.message.id;
      const isArchived = archivedMessages.has(messageId);
      const isDeleted = deletedMessages.has(messageId);
      const isLocallyArchived = locallyArchivedMessages.has(messageId);
      
      
      return !isArchived && !isDeleted && !isLocallyArchived;
    });
    
    
    if (!searchQuery.trim()) {
      return visibleMessages;
    }

    const query = searchQuery.toLowerCase();
    return visibleMessages.filter(thread => {
      const message = thread.message;
      const from = (message.from || '').toLowerCase();
      const subject = (message.subject || '').toLowerCase();
      const snippet = (message.snippet || '').toLowerCase();
      const body = (message.body || '').toLowerCase();
      
      return from.includes(query) || 
             subject.includes(query) || 
             snippet.includes(query) || 
             body.includes(query);
    });
  }, [messages, searchQuery, archivedMessages, deletedMessages, locallyArchivedMessages]);

  // Function to move to next message after action
  const moveToNextMessage = () => {
    setCurrentMessageIndex(prev => {
      const nextIndex = prev + 1;
      return nextIndex < filteredMessages.length ? nextIndex : 0; // Loop back to start
    });
  };

  // Reset index when filtered messages change
  useEffect(() => {
    if (currentMessageIndex >= filteredMessages.length && filteredMessages.length > 0) {
      setCurrentMessageIndex(0);
    }
  }, [filteredMessages.length, currentMessageIndex]);

  useEffect(() => {
    if (isConnected) {
      // Only load stats on connection, no automatic API calls
      loadApiStats();
    }
  }, [isConnected]);

  // Keyboard shortcuts for navigation and refresh
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
        loadMessages();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveToNextMessage();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentMessageIndex(prev => prev > 0 ? prev - 1 : filteredMessages.length - 1);
      } else if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (filteredMessages[currentMessageIndex]) {
          handleArchiveMessage(filteredMessages[currentMessageIndex].message.id);
        }
      } else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (filteredMessages[currentMessageIndex]) {
          const messageId = filteredMessages[currentMessageIndex].message.id;
          handleDeleteMessage(messageId);
        }
      } else if (e.key === 'z' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (filteredMessages[currentMessageIndex]) {
          const messageId = filteredMessages[currentMessageIndex].message.id;
          handleArchiveLocally(messageId);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredMessages, currentMessageIndex]);

  const loadMessages = async () => {
    if (isRefreshing) return; // Prevent multiple simultaneous calls
    
    setIsRefreshing(true);
    
    // Store current selection before refresh
    const currentMessageId = filteredMessages[currentMessageIndex]?.message?.id;
    
    try {
      const result = await Meteor.callAsync('gmail.listMessages', '', 20);
      
      // Refresh stats after API call
      loadApiStats();
      
      // Show notification with detailed results
      const newMessagesCount = result?.newMessagesCount || 0;
      const successCount = result?.successCount || 0;
      const errorCount = result?.errorCount || 0;
      
      if (newMessagesCount > 0) {
        if (errorCount > 0) {
          notify({ 
            message: `Refresh completed: ${successCount} emails loaded successfully, ${errorCount} failed to load`, 
            kind: 'warning',
            duration: 6000
          });
          
          // Log error details for debugging
          if (result?.errorDetails?.length > 0) {
            console.warn('Email loading errors:', result.errorDetails);
          }
        } else {
          notify({ 
            message: `Refresh completed: ${newMessagesCount} new email${newMessagesCount > 1 ? 's' : ''} fetched successfully`, 
            kind: 'success' 
          });
        }
      } else {
        notify({ 
          message: 'Refresh completed: No new emails found', 
          kind: 'info' 
        });
      }
      
      // Restore selection after refresh if possible
      if (currentMessageId) {
        setTimeout(() => {
          const newIndex = filteredMessages.findIndex(thread => thread.message.id === currentMessageId);
          if (newIndex !== -1) {
            setCurrentMessageIndex(newIndex);
          }
        }, 100); // Small delay to ensure state is updated
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      notify({ message: `Failed to load messages: ${error?.message || 'Unknown error'}`, kind: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  };


  const loadApiStats = async () => {
    try {
      const [apiStatsData, emailStatsData, ctaStatsData] = await Promise.all([
        Meteor.callAsync('gmail.getApiStats'),
        Meteor.callAsync('gmail.getEmailStats'),
        Meteor.callAsync('emails.getCtaStats')
      ]);
      setApiStats(apiStatsData);
      setEmailStats(emailStatsData);
      setCtaStats(ctaStatsData);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleCleanupDuplicates = async () => {
    try {
      const result = await Meteor.callAsync('gmail.cleanupDuplicates');
      
      if (result.success) {
        if (result.removedCount > 0) {
          notify({ 
            message: `Cleanup completed: Removed ${result.removedCount} duplicate messages`, 
            kind: 'success' 
          });
        } else {
          notify({ 
            message: 'No duplicates found in the database', 
            kind: 'info' 
          });
        }
        
        // Refresh stats after cleanup
        loadApiStats();
      }
    } catch (error) {
      console.error('Failed to cleanup duplicates:', error);
      notify({ message: `Failed to cleanup duplicates: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const handleSyncLabels = async () => {
    if (isSyncingLabels) return; // Prevent multiple simultaneous calls
    
    setIsSyncingLabels(true);
    
    try {
      const result = await Meteor.callAsync('gmail.syncLabels', 50);
      
      // Refresh stats after sync
      loadApiStats();
      
      // Show notification with detailed results
      const processedCount = result?.processedCount || 0;
      const successCount = result?.successCount || 0;
      const errorCount = result?.errorCount || 0;
      
      if (errorCount > 0) {
        notify({ 
          message: `Label sync completed: ${successCount} messages processed successfully, ${errorCount} failed`, 
          kind: 'warning',
          duration: 6000
        });
        
        // Log error details for debugging
        if (result?.errorDetails?.length > 0) {
          console.warn('Label sync errors:', result.errorDetails);
        }
      } else {
        notify({ 
          message: `Label sync completed: ${processedCount} messages processed successfully`, 
          kind: 'success' 
        });
      }
    } catch (error) {
      console.error('Failed to sync labels:', error);
      
      // Check if it's an OAuth2/token error
      const errorMessage = error?.message || 'Unknown error';
      const isOAuthError = error?.error === 'oauth-expired' ||
                          errorMessage.includes('oauth2') || 
                          errorMessage.includes('token') || 
                          errorMessage.includes('unauthorized') ||
                          errorMessage.includes('authentication') ||
                          errorMessage.includes('Gmail connection expired');
      
      if (isOAuthError) {
        notify({ 
          message: 'Gmail connection expired. Please reconnect to Gmail to sync labels.', 
          kind: 'error',
          duration: 8000
        });
      } else {
        notify({ 
          message: `Failed to sync labels: ${errorMessage}`, 
          kind: 'error' 
        });
      }
    } finally {
      setIsSyncingLabels(false);
    }
  };

  const handleNavigateToInboxZero = () => {
    navigateTo({ name: 'inboxZero' });
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const authUrl = await Meteor.callAsync('gmail.getAuthUrl');
      // Open OAuth URL in new window
      const popup = window.open(authUrl, 'gmail-oauth', 'width=500,height=600');
      
      // Listen for OAuth completion
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          // Just refresh stats after OAuth, no automatic API calls
          setTimeout(() => {
            loadApiStats();
          }, 1000);
        }
      }, 1000);
    } catch (error) {
      console.error('Failed to start OAuth:', error);
      
      const errorMessage = error?.message || 'Unknown error';
      const errorType = error?.error;
      
      let userMessage;
      
      if (errorType === 'network-error') {
        userMessage = 'Network error connecting to Gmail. Please check your internet connection and try again.';
      } else if (errorType === 'oauth-invalid') {
        userMessage = 'Invalid authorization. Please try connecting to Gmail again.';
      } else if (errorType === 'oauth-failed') {
        userMessage = `Gmail connection failed: ${errorMessage}`;
      } else if (errorMessage.includes('request to') && errorMessage.includes('failed')) {
        userMessage = 'Network error connecting to Google OAuth2. Please check your internet connection and try again.';
      } else {
        userMessage = `Failed to connect: ${errorMessage}`;
      }
      
      notify({ message: userMessage, kind: 'error', duration: 8000 });
      setIsConnecting(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    
    if (searchFromGmail) {
      // Search via Gmail API and store results
      try {
        const result = await Meteor.callAsync('gmail.listMessages', searchQuery, 20);
        
        // Show detailed search results
        const newMessagesCount = result?.newMessagesCount || 0;
        const successCount = result?.successCount || 0;
        const errorCount = result?.errorCount || 0;
        
        if (newMessagesCount > 0) {
          if (errorCount > 0) {
            notify({ 
              message: `Gmail search completed: ${successCount} emails found and loaded, ${errorCount} failed to load`, 
              kind: 'warning',
              duration: 6000
            });
          } else {
            notify({ 
              message: `Gmail search completed: ${newMessagesCount} email${newMessagesCount > 1 ? 's' : ''} found and loaded`, 
              kind: 'success' 
            });
          }
        } else {
          notify({ 
            message: 'Gmail search completed: No new emails found matching your query', 
            kind: 'info' 
          });
        }
      } catch (error) {
        console.error('Failed to search via Gmail API:', error);
        notify({ message: `Gmail search failed: ${error?.message || 'Unknown error'}`, kind: 'error' });
      }
    } else {
      // DB search - no API call needed, just trigger re-render
      notify({ message: 'Search completed in local database', kind: 'info' });
    }
  };

  const handleOpenMessage = async (messageId) => {
    try {
      // Find the message to get its threadId (use messages since we're opening from the inbox)
      const thread = messages.find(t => t.message.id === messageId);
      if (!thread) {
        notify({ message: 'Message not found', kind: 'error' });
        return;
      }
      
      const message = thread.message;

      // Get all messages in the same thread via RPC
      const threadMessages = await Meteor.callAsync('gmail.getThreadMessages', message.threadId);

      // Check if any messages in the thread are missing content
      const messagesNeedingContent = threadMessages.filter(m => !m.body && !m.fullPayload);
      
      if (messagesNeedingContent.length > 0) {
        // Load missing content for messages that don't have body or fullPayload
        try {
          for (const msg of messagesNeedingContent) {
            const fullMessage = await Meteor.callAsync('gmail.getMessage', msg.id);
            // Update the message in our local array
            const index = threadMessages.findIndex(m => m.id === msg.id);
            if (index !== -1) {
              threadMessages[index] = fullMessage;
            }
          }
        } catch (error) {
          console.error('Failed to load some message content:', error);
          // Continue anyway with what we have
        }
      }

      setSelectedMessage({
        ...message,
        threadMessages: threadMessages
      });
    } catch (error) {
      console.error('Failed to load message:', error);
      notify({ message: `Failed to load message: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const handleArchiveMessage = (messageId) => {
    // Optimistic UI: immediately remove from UI
    setArchivedMessages(prev => new Set([...prev, messageId]));
    notify({ message: 'Message archived', kind: 'success' });
    
    // Move to next message immediately - but ensure we don't go out of bounds
    setCurrentMessageIndex(prev => {
      // After archiving, the current index will point to the next message
      // If we're at the end, go back to the beginning
      const newIndex = prev < filteredMessages.length - 1 ? prev : 0;
      return newIndex;
    });
    
    // Call API in background without blocking UI
    Meteor.callAsync('gmail.archiveMessage', messageId)
      .then(() => {
        // No need to reload - optimistic UI already handles the display
      })
      .catch((error) => {
        console.error('Failed to archive message:', error);
        
        // Revert optimistic UI on error
        setArchivedMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        
        // Check if it's an OAuth2/token error
        const errorMessage = error?.message || 'Unknown error';
        const isOAuthError = error?.error === 'oauth-expired' ||
                            errorMessage.includes('oauth2') || 
                            errorMessage.includes('token') || 
                            errorMessage.includes('unauthorized') ||
                            errorMessage.includes('authentication') ||
                            errorMessage.includes('Gmail connection expired');
        
        if (isOAuthError) {
          notify({ 
            message: 'Gmail connection expired. Please reconnect to Gmail to archive messages.', 
            kind: 'error',
            duration: 8000
          });
        } else {
          notify({ 
            message: `Failed to archive: ${errorMessage}`, 
            kind: 'error' 
          });
        }
      });
  };

  const handleDeleteMessage = (messageId) => {
    // Optimistic UI: immediately remove from UI
    setDeletedMessages(prev => {
      const newSet = new Set([...prev, messageId]);
      return newSet;
    });
    notify({ message: 'Message deleted', kind: 'success' });
    
    // Move to next message immediately - but ensure we don't go out of bounds
    setCurrentMessageIndex(prev => {
      // After deletion, the current index will point to the next message
      // If we're at the end, go back to the beginning
      const newIndex = prev < filteredMessages.length - 1 ? prev : 0;
      return newIndex;
    });
    
    // Call API in background without blocking UI
    Meteor.callAsync('emails.moveToTrash', messageId)
      .then(() => {
        // No need to reload - optimistic UI already handles the display
      })
      .catch((error) => {
        console.error('Failed to delete message:', error);
        
        // Revert optimistic UI on error
        setDeletedMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        
        // Check if it's an OAuth2/token error
        const errorMessage = error?.message || 'Unknown error';
        const isOAuthError = error?.error === 'oauth-expired' ||
                            errorMessage.includes('oauth2') || 
                            errorMessage.includes('token') || 
                            errorMessage.includes('unauthorized') ||
                            errorMessage.includes('authentication') ||
                            errorMessage.includes('Gmail connection expired');
        
        if (isOAuthError) {
          notify({ 
            message: 'Gmail connection expired. Please reconnect to Gmail to delete messages.', 
            kind: 'error',
            duration: 8000
          });
        } else {
          notify({ 
            message: `Failed to delete: ${errorMessage}`, 
            kind: 'error' 
          });
        }
      });
  };

  const handleArchiveLocally = (messageId) => {
    // Optimistic UI: immediately remove from UI
    setLocallyArchivedMessages(prev => new Set([...prev, messageId]));
    notify({ message: 'Message archived locally', kind: 'success' });
    
    // Move to next message immediately - but ensure we don't go out of bounds
    setCurrentMessageIndex(prev => {
      // After local archiving, the current index will point to the next message
      // If we're at the end, go back to the beginning
      const newIndex = prev < filteredMessages.length - 1 ? prev : 0;
      return newIndex;
    });
    
    // Call API in background without blocking UI
    Meteor.callAsync('emails.archiveLocally', messageId)
      .then(() => {
        // No need to reload - optimistic UI already handles the display
      })
      .catch((error) => {
        console.error('Failed to archive message locally:', error);
        
        // Revert optimistic UI on error
        setLocallyArchivedMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        
        notify({ 
          message: `Failed to archive locally: ${error?.message || 'Unknown error'}`, 
          kind: 'error' 
        });
      });
  };

  const handleAddLabel = async (messageId, labelId) => {
    try {
      await Meteor.callAsync('gmail.addLabel', messageId, labelId);
      notify({ message: 'Label added', kind: 'success' });
      // No need to refresh stats for label operations
    } catch (error) {
      console.error('Failed to add label:', error);
      notify({ message: `Failed to add label: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const handleAnalyzeEmail = async (data) => {
    try {
      // Handle both single message and thread data
      const message = data.message || data;
      const threadMessages = data.threadMessages || [message];
      
      // Show loading state in modal
      setAnalysisModal({
        message: message,
        analysis: null,
        loading: true,
        error: null
      });
      
      // Prepare thread content for analysis
      const threadContent = threadMessages.map((threadMessage, index) => {
        const headers = threadMessage.headers || threadMessage.fullPayload?.headers || [];
        const from = threadMessage.from || getHeaderValue(headers, 'From') || '';
        const to = threadMessage.to || getHeaderValue(headers, 'To') || '';
        const date = threadMessage.gmailDate || getHeaderValue(headers, 'Date') || '';
        
        return {
          messageIndex: index + 1,
          from: from,
          to: to,
          date: date,
          body: threadMessage.body || threadMessage.snippet || '',
          snippet: threadMessage.snippet || ''
        };
      });
      
      const result = await Meteor.callAsync('gmail.analyzeThread', {
        subject: message.subject || '',
        threadContent: threadContent
      });
      
      // Update modal with analysis result
      setAnalysisModal({
        message: message,
        analysis: result,
        loading: false,
        error: null
      });
    } catch (error) {
      console.error('Failed to analyze email:', error);
      
      // Update modal with error
      setAnalysisModal({
        message: data.message || data,
        analysis: null,
        loading: false,
        error: error?.message || 'Unknown error'
      });
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'No date';
    
    try {
      // Handle both Date objects and date strings
      const date = dateString instanceof Date ? dateString : new Date(dateString);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch (error) {
      console.error('Date parsing error:', error, 'for date:', dateString);
      return 'Invalid date';
    }
  };

  const getHeaderValue = (headers, name) => {
    const header = headers?.find(h => h.name?.toLowerCase() === name.toLowerCase());
    return header?.value || '';
  };

  if (subTokens() || isLoadingThreads) {
    return <div>Loading…</div>;
  }

  if (!isConnected) {
    return (
      <div>
        <h2>Gmail</h2>
        <Card>
          <div className="connectSection">
            <h3>Connect to Gmail</h3>
            <p>Connect your Gmail account to view and manage emails directly in Panorama.</p>
            <button 
              className="btn btn-primary" 
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect Gmail'}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2>Gmail</h2>
      
      <EmailsToolbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchFromGmail={searchFromGmail}
        setSearchFromGmail={setSearchFromGmail}
        onSearch={handleSearch}
        onRefresh={loadMessages}
        isRefreshing={isRefreshing}
        onSyncLabels={handleSyncLabels}
        isSyncingLabels={isSyncingLabels}
        onToggleApiStats={() => setShowApiStats(!showApiStats)}
        showApiStats={showApiStats}
        onNavigateToInboxZero={handleNavigateToInboxZero}
      />

      {showApiStats && (
        <ApiStats
          apiStats={apiStats}
          emailStats={emailStats}
          threadsCount={messages.length}
          ctaStats={ctaStats}
          onRefreshStats={loadApiStats}
          onCleanupDuplicates={handleCleanupDuplicates}
        />
      )}

      {filteredMessages.length === 0 ? (
        <div>No emails found.</div>
      ) : (
        <div className="emailsList">
          <div className="emailsListHeader">
            <span className="emailsCount">
              {filteredMessages.length} conversation{filteredMessages.length > 1 ? 's' : ''} 
              {filteredMessages.some(thread => thread.threadTotalCount > 1) && (
                <span className="threadContextInfo">
                  • {filteredMessages.reduce((total, thread) => total + thread.threadTotalCount, 0)} total messages in threads
                </span>
              )}
            </span>
            <span className="threadExplanation">
              💬 Conversations are grouped by thread • Complete thread context shown
              <br />
              <span className="keyboardShortcuts">
                ⌨️ Navigation: ↑↓ • Actions: A (archive) • D (delete) • Z (archive locally) • Refresh: F5
                <br />
                💡 Use keyboard shortcuts for quick actions (buttons removed for cleaner interface)
              </span>
            </span>
          </div>
          {filteredMessages.map((thread, index) => (
            <EmailRow
              key={thread.message.threadId}
              message={thread.message}
              threadCount={thread.threadTotalCount}
              onOpen={handleOpenMessage}
              onArchive={handleArchiveMessage}
              onDelete={handleDeleteMessage}
              onAddLabel={handleAddLabel}
              onAnalyze={handleAnalyzeEmail}
              labels={[]}
              formatDate={formatDate}
              threadContext={thread.threadContext}
              isSelected={index === currentMessageIndex}
            />
          ))}
        </div>
      )}

      {selectedMessage && (
        <MessageModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onArchive={handleArchiveMessage}
          onAddLabel={handleAddLabel}
          onAnalyze={handleAnalyzeEmail}
          labels={[]}
          formatDate={formatDate}
          getHeaderValue={getHeaderValue}
        />
      )}

      {analysisModal && (
        <AnalysisModal
          modal={analysisModal}
          onClose={() => setAnalysisModal(null)}
          formatDate={formatDate}
        />
      )}
    </div>
  );
};


