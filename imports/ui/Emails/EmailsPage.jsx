import React, { useState, useEffect, useMemo } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection } from '../../api/emails/collections';
import { Card } from '../components/Card/Card.jsx';
import { notify } from '../utils/notify.js';
import './EmailsPage.css';

export const EmailsPage = () => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [labels, setLabels] = useState([]);

  const subTokens = useSubscribe('gmail.tokens');
  const subMessages = useSubscribe('gmail.messages');
  const tokens = useFind(() => GmailTokensCollection.find({}))[0];
  const allMessages = useFind(() => GmailMessagesCollection.find({}, { sort: { gmailDate: -1 } }));

  const isConnected = !!tokens?.access_token;

  // Deduplicate by threadId and count messages per thread
  const messages = useMemo(() => {
    const threadMap = new Map();
    
    allMessages.forEach(message => {
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
  }, [allMessages]);

  useEffect(() => {
    if (isConnected) {
      loadMessages();
      loadLabels();
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
    try {
      await Meteor.callAsync('gmail.listMessages', searchQuery, 20);
    } catch (error) {
      console.error('Failed to load messages:', error);
      notify({ message: `Failed to load messages: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const loadLabels = async () => {
    try {
      const labelsData = await Meteor.callAsync('gmail.getLabels');
      setLabels(labelsData);
    } catch (error) {
      console.error('Failed to load labels:', error);
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
          // Refresh messages after OAuth
          setTimeout(() => {
            loadMessages();
            loadLabels();
          }, 1000);
        }
      }, 1000);
    } catch (error) {
      console.error('Failed to start OAuth:', error);
      notify({ message: `Failed to connect: ${error?.message || 'Unknown error'}`, kind: 'error' });
      setIsConnecting(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadMessages();
  };

  const handleOpenMessage = async (messageId) => {
    try {
      const message = await Meteor.callAsync('gmail.getMessage', messageId);
      setSelectedMessage(message);
    } catch (error) {
      console.error('Failed to load message:', error);
      notify({ message: `Failed to load message: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const handleArchiveMessage = async (messageId) => {
    try {
      await Meteor.callAsync('gmail.archiveMessage', messageId);
      notify({ message: 'Message archived', kind: 'success' });
      loadMessages(); // Refresh the list
    } catch (error) {
      console.error('Failed to archive message:', error);
      notify({ message: `Failed to archive: ${error?.message || 'Unknown error'}`, kind: 'error' });
    }
  };

  const handleAddLabel = async (messageId, labelId) => {
    try {
      await Meteor.callAsync('gmail.addLabel', messageId, labelId);
      notify({ message: 'Label added', kind: 'success' });
    } catch (error) {
      console.error('Failed to add label:', error);
      notify({ message: `Failed to add label: ${error?.message || 'Unknown error'}`, kind: 'error' });
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
      
      <div className="emailsToolbar">
        <form onSubmit={handleSearch} className="searchForm">
          <input
            type="text"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="searchInput"
          />
          <button type="submit" className="btn">Search</button>
        </form>
        <button 
          className="btn" 
          onClick={loadMessages}
          title="Refresh emails"
        >
          ↻ Refresh
        </button>
      </div>

      <Card>
        {messages.length === 0 ? (
          <div>No emails found.</div>
        ) : (
          <div className="emailsList">
            {messages.map((thread) => (
              <EmailRow
                key={thread.message.threadId}
                message={thread.message}
                threadCount={thread.count}
                onOpen={handleOpenMessage}
                onArchive={handleArchiveMessage}
                onAddLabel={handleAddLabel}
                labels={labels}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </Card>

      {selectedMessage && (
        <MessageModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onArchive={handleArchiveMessage}
          onAddLabel={handleAddLabel}
          labels={labels}
          formatDate={formatDate}
          getHeaderValue={getHeaderValue}
        />
      )}
    </div>
  );
};

const EmailRow = ({ message, threadCount, onOpen, onArchive, onAddLabel, labels, formatDate }) => {
  // Use stored data from database - no API calls needed
  const from = message.from || '';
  const subject = message.subject || '';
  const gmailDate = message.gmailDate || new Date();
  const snippet = message.snippet || '';

  return (
    <div className="emailRow">
      <div className="emailContent">
        <div className="emailHeader">
          <span className="emailFrom">{from}</span>
          <span className="emailDate">{formatDate(gmailDate)}</span>
        </div>
        <div className="emailSubject">
          {subject}
          {threadCount > 1 && (
            <span className="threadCount">({threadCount} messages)</span>
          )}
        </div>
        <div className="emailSnippet">{snippet}</div>
      </div>
      <div className="emailActions">
        <button 
          className="btn btn-sm" 
          onClick={() => onOpen(message.id)}
        >
          Open
        </button>
        <button 
          className="btn btn-sm" 
          onClick={() => onArchive(message.id)}
        >
          Archive
        </button>
        <button 
          className="btn btn-sm" 
          onClick={() => onAddLabel(message.id, 'IMPORTANT')}
        >
          Mark Important
        </button>
      </div>
    </div>
  );
};

const MessageModal = ({ message, onClose, onArchive, onAddLabel, labels, formatDate, getHeaderValue }) => {
  // Use stored data from database if available
  const headers = message.payload?.headers || message.headers || [];
  const from = getHeaderValue(headers, 'From') || message.from || '';
  const to = getHeaderValue(headers, 'To') || message.to || '';
  const subject = getHeaderValue(headers, 'Subject') || message.subject || '';
  const date = getHeaderValue(headers, 'Date') || message.gmailDate || '';
  const snippet = message.snippet || '';

  const getMessageBody = (payload) => {
    // Use stored body if available
    if (message.body) {
      return message.body;
    }
    
    // Fallback to extracting from payload
    if (payload?.body?.data) {
      return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    if (payload?.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
      }
    }
    return snippet;
  };

  const body = getMessageBody(message.payload);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>{subject}</h3>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody">
          <div className="messageMeta">
            <div><strong>From:</strong> {from}</div>
            <div><strong>To:</strong> {to}</div>
            <div><strong>Date:</strong> {formatDate(date)}</div>
          </div>
          <div className="messageBody">
            <pre>{body}</pre>
          </div>
        </div>
        <div className="modalFooter">
          <button 
            className="btn" 
            onClick={() => onArchive(message.id)}
          >
            Archive
          </button>
          <button 
            className="btn" 
            onClick={() => onAddLabel(message.id, 'IMPORTANT')}
          >
            Mark Important
          </button>
        </div>
      </div>
    </div>
  );
};