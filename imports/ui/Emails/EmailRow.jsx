import React from 'react';

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

export const EmailRow = ({ message, threadCount, onOpen, onArchive, onAddLabel, onAnalyze, labels, formatDate }) => {
  // Use stored data from database - no API calls needed
  const from = message.from || '';
  const subject = message.subject || '';
  const snippet = message.snippet || '';
  const gmailDate = message.gmailDate || new Date();
  const labelIds = message.labelIds || [];
  
  // Extract sender name only
  const senderName = extractSenderName(from);

  // Helper function to get label display name
  const getLabelDisplayName = (labelId) => {
    if (labelId === 'INBOX') return 'Inbox';
    if (labelId === 'UNREAD') return 'Unread';
    if (labelId === 'IMPORTANT') return 'Important';
    if (labelId === 'STARRED') return 'Starred';
    if (labelId === 'SENT') return 'Sent';
    if (labelId === 'DRAFT') return 'Draft';
    if (labelId === 'SPAM') return 'Spam';
    if (labelId === 'TRASH') return 'Trash';
    // For custom labels, try to find the name from the labels array
    const customLabel = labels?.find(l => l.id === labelId);
    return customLabel?.name || labelId;
  };

  const handleRowClick = (e) => {
    // Don't open if clicking on action buttons
    if (e.target.closest('.emailActions')) {
      return;
    }
    onOpen(message.id);
  };

  // Check if email is unread
  const isUnread = labelIds.includes('UNREAD');

  return (
    <div className={`emailRow clickable ${isUnread ? 'unread' : 'read'}`} onClick={handleRowClick}>
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
        <div className="emailLabels">
          {labelIds.map((labelId) => (
            <span key={labelId} className={`emailLabel label-${labelId.toLowerCase()}`}>
              {getLabelDisplayName(labelId)}
            </span>
          ))}
        </div>
        <span className="emailDate">{formatDate(gmailDate)}</span>
      </div>
      <div className="emailActions">
        <button 
          className="btn btn-sm btn-analyze" 
          onClick={() => onAnalyze(message)}
        >
          Analyse
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
