import React, { useState, useEffect, useMemo } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection } from '../../api/emails/collections';
import { Card } from '../components/Card/Card.jsx';
import { notify } from '../utils/notify.js';
import { MessageModal } from './MessageModal.jsx';
import { EmailRow } from './EmailRow.jsx';
import { AnalysisModal } from './AnalysisModal.jsx';
import { EmailsToolbar } from './EmailsToolbar.jsx';
import { ApiStats } from './ApiStats.jsx';
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
  const [showApiStats, setShowApiStats] = useState(false);
  const [analysisModal, setAnalysisModal] = useState(null);
  const [archivedMessages, setArchivedMessages] = useState(new Set());

  const subTokens = useSubscribe('gmail.tokens');
  const subMessages = useSubscribe('gmail.messages');
  const tokens = useFind(() => GmailTokensCollection.find({}))[0];
  const inboxMessages = useFind(() => GmailMessagesCollection.find({}, { sort: { gmailDate: -1 } }));
  

  const isConnected = !!tokens?.access_token;

  // Filter messages based on search query (DB search) and exclude locally archived messages
  const filteredMessages = useMemo(() => {
    // Filter out locally archived messages (INBOX filtering is now done in the subscription)
    const nonArchivedMessages = inboxMessages.filter(message => !archivedMessages.has(message.id));
    
    if (!searchQuery.trim()) {
      return nonArchivedMessages;
    }

    const query = searchQuery.toLowerCase();
    return nonArchivedMessages.filter(message => {
      const from = (message.from || '').toLowerCase();
      const subject = (message.subject || '').toLowerCase();
      const snippet = (message.snippet || '').toLowerCase();
      const body = (message.body || '').toLowerCase();
      
      return from.includes(query) || 
             subject.includes(query) || 
             snippet.includes(query) || 
             body.includes(query);
    });
  }, [inboxMessages, searchQuery, archivedMessages]);

  // Deduplicate by threadId and count messages per thread
  const messages = useMemo(() => {
    const threadMap = new Map();
    
    filteredMessages.forEach(message => {
      const threadId = message.threadId;
      
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, {
          message: message,
          count: 0
        });
      }
      
      // Always keep the most recent message for this thread
      const existing = threadMap.get(threadId);
      if (message.gmailDate > existing.message.gmailDate) {
        existing.message = message;
      }
      
      // Increment count
      existing.count++;
    });
    
    // Convert to array and sort by the most recent message date
    return Array.from(threadMap.values())
      .sort((a, b) => b.message.gmailDate - a.message.gmailDate);
  }, [filteredMessages]);

  useEffect(() => {
    if (isConnected) {
      // Only load stats on connection, no automatic API calls
      loadApiStats();
    }
  }, [isConnected]);

  // Keyboard shortcut for refresh (F5 or Ctrl+R)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
        loadMessages();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadMessages = async () => {
    if (isRefreshing) return; // Prevent multiple simultaneous calls
    
    setIsRefreshing(true);
    
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
    } catch (error) {
      console.error('Failed to load messages:', error);
      notify({ message: `Failed to load messages: ${error?.message || 'Unknown error'}`, kind: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  };


  const loadApiStats = async () => {
    try {
      const [apiStatsData, emailStatsData] = await Promise.all([
        Meteor.callAsync('gmail.getApiStats'),
        Meteor.callAsync('gmail.getEmailStats')
      ]);
      setApiStats(apiStatsData);
      setEmailStats(emailStatsData);
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
      
      let userMessage = 'Failed to connect to Gmail';
      
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
      // Find the message to get its threadId (use inboxMessages since we're opening from the inbox)
      const message = inboxMessages.find(m => m.id === messageId);
      if (!message) {
        notify({ message: 'Message not found', kind: 'error' });
        return;
      }

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

  const handleArchiveMessage = async (messageId) => {
    // Optimistic UI: immediately remove from UI
    setArchivedMessages(prev => new Set([...prev, messageId]));
    notify({ message: 'Message archived', kind: 'success' });
    
    // Call API in background
    try {
      await Meteor.callAsync('gmail.archiveMessage', messageId);
      // API call successful, the message is already removed from UI
    } catch (error) {
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
        // Optionally, you could trigger a reconnection flow here
        // or redirect to the connection page
      } else {
        notify({ 
          message: `Failed to archive: ${errorMessage}`, 
          kind: 'error' 
        });
      }
    }
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

  if (subTokens() || subMessages()) {
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
      />

      {showApiStats && (
        <ApiStats
          apiStats={apiStats}
          emailStats={emailStats}
          threadsCount={messages.length}
          onRefreshStats={loadApiStats}
          onCleanupDuplicates={handleCleanupDuplicates}
        />
      )}

      {messages.length === 0 ? (
        <div>No emails found.</div>
      ) : (
        <div className="emailsList">
          <div className="emailsListHeader">
            <span className="emailsCount">
              {messages.length} conversation{messages.length > 1 ? 's' : ''} 
              ({filteredMessages.length} inbox messages)
            </span>
            <span className="threadExplanation">
              💬 Conversations are grouped by thread • Only inbox messages shown
            </span>
          </div>
          {messages.map((thread) => (
            <EmailRow
              key={thread.message.threadId}
              message={thread.message}
              threadCount={thread.count}
              onOpen={handleOpenMessage}
              onArchive={handleArchiveMessage}
              onAddLabel={handleAddLabel}
              onAnalyze={handleAnalyzeEmail}
              labels={[]}
              formatDate={formatDate}
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


