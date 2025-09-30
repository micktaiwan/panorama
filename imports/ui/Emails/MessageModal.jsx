import React, { useEffect, useState } from 'react';

// Helper function to decode base64 with proper UTF-8 handling
const decodeBase64UTF8 = (data) => {
  try {
    // Decode base64
    const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = atob(base64Data);
    
    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Decode as UTF-8
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch (error) {
    console.error('Error decoding base64:', error);
    // Fallback to simple atob if UTF-8 decoding fails
    return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  }
};

// Helper function to decode HTML entities
const decodeHtmlEntities = (text) => {
  if (!text) return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

export const MessageModal = ({ message, onClose, onArchive, onAddLabel, onAnalyze, labels, formatDate, getHeaderValue }) => {
  // Use stored data from database if available
  const headers = message.payload?.headers || message.headers || [];
  const subject = getHeaderValue(headers, 'Subject') || message.subject || '';
  const snippet = message.snippet || '';
  
  const threadMessages = message.threadMessages || [message];
  const [expandedMessages, setExpandedMessages] = useState(new Set([threadMessages.length - 1])); // Only last message expanded by default

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


  const toggleMessage = (index) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedMessages(newExpanded);
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>{subject}</h3>
          <div className="threadInfo">{threadMessages.length} message{threadMessages.length > 1 ? 's' : ''}</div>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        
        <div className="threadContainer">
          {threadMessages.map((threadMessage, index) => {
            const threadHeaders = threadMessage.headers || threadMessage.fullPayload?.headers || [];
            const threadFrom = threadMessage.from || getHeaderValue(threadHeaders, 'From') || '';
            const threadTo = threadMessage.to || getHeaderValue(threadHeaders, 'To') || '';
            const threadDate = threadMessage.gmailDate || getHeaderValue(threadHeaders, 'Date') || '';
            
            // Create a proper getMessageBody function for this specific thread message
            const getThreadMessageBody = (payload) => {
              // Use stored body if available for THIS specific message
              if (threadMessage.body) {
                return threadMessage.body;
              }
              
              // Fallback to extracting from payload
              if (payload?.body?.data) {
                return decodeBase64UTF8(payload.body.data);
              }
              if (payload?.parts) {
                for (const part of payload.parts) {
                  if (part.mimeType === 'text/plain' && part.body?.data) {
                    return decodeBase64UTF8(part.body.data);
                  }
                  if (part.mimeType === 'text/html' && part.body?.data) {
                    return decodeBase64UTF8(part.body.data);
                  }
                }
              }
              return threadMessage.snippet || '';
            };
            
            const threadBody = decodeHtmlEntities(getThreadMessageBody(threadMessage.fullPayload) || threadMessage.body || threadMessage.snippet || '');
            const isExpanded = expandedMessages.has(index);
            const isLastMessage = index === threadMessages.length - 1;
            
            return (
              <div key={threadMessage.id} className={`threadMessage ${isLastMessage ? 'lastMessage' : ''}`}>
                <div 
                  className={`threadMessageHeader ${isExpanded ? 'expanded' : 'collapsed'}`}
                  onClick={() => toggleMessage(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleMessage(index);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="threadMessageMeta">
                    <span><strong>From:</strong> {threadFrom}</span>
                    <span><strong>To:</strong> {threadTo}</span>
                    <span><strong>Date:</strong> {formatDate(threadDate)}</span>
                  </div>
                  <div className="expandIndicator">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>
                {isExpanded && (
                  <div className="threadMessageBody">
                    <pre>{threadBody}</pre>
                  </div>
                )}
                {index < threadMessages.length - 1 && <div className="threadSeparator"></div>}
              </div>
            );
          })}
        </div>
        
        <div className="modalFooter">
          <button className="btn btn-analyze" onClick={() => onAnalyze({ message, threadMessages })}>Analyse Thread</button>
          <button className="btn" onClick={() => { onArchive(message.id); onClose(); }}>Archive</button>
          <button className="btn" onClick={() => onAddLabel(message.id, 'IMPORTANT')}>Mark Important</button>
        </div>
      </div>
    </div>
  );
};
