import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { google } from 'googleapis';
import { GmailTokensCollection, GmailMessagesCollection } from './collections.js';

// OAuth2 configuration
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  Meteor.settings.gmail?.clientId,
  Meteor.settings.gmail?.clientSecret,
  REDIRECT_URI
);

// API call counter for monitoring
let apiCallCount = 0;

// Helper function to ensure valid tokens before API calls
async function ensureValidTokens() {
  const tokenDoc = await GmailTokensCollection.findOneAsync({});
  if (!tokenDoc) {
    throw new Meteor.Error('not-authorized', 'Gmail not connected');
  }

  // Set credentials
  oauth2Client.setCredentials(tokenDoc);

  // Check if token is expired or will expire soon (within 5 minutes)
  const now = Date.now();
  const expiresIn = tokenDoc.expiry_date;
  
  if (expiresIn && (now + 5 * 60 * 1000) >= expiresIn) {
    console.log('[GMAIL API] Token expired or expiring soon, attempting refresh...');
    
    try {
      // Force token refresh
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update tokens in database
      await GmailTokensCollection.upsertAsync({}, {
        $set: {
          ...credentials,
          updatedAt: new Date(),
        }
      });
      
      console.log('[GMAIL API] Tokens refreshed successfully');
      return credentials;
    } catch (refreshError) {
      console.error('[GMAIL API ERROR] Token refresh failed:', refreshError);
      
      // Check if it's a network error
      const errorMessage = refreshError.message || 'Unknown error';
      const isNetworkError = errorMessage.includes('request to') && 
                            errorMessage.includes('failed') ||
                            refreshError.code === 'ENOTFOUND' ||
                            refreshError.code === 'ECONNREFUSED' ||
                            refreshError.code === 'ETIMEDOUT';
      
      if (isNetworkError) {
        throw new Meteor.Error('network-error', 'Network error refreshing Gmail tokens. Please check your internet connection.');
      }
      
      // If refresh fails, clear tokens and require reconnection
      await GmailTokensCollection.removeAsync({});
      console.log('[GMAIL API] Cleared invalid tokens due to refresh failure');
      throw new Meteor.Error('oauth-expired', 'Gmail connection expired. Please reconnect to Gmail.');
    }
  }

  return tokenDoc;
}

const logApiCall = (method, endpoint, details = '') => {
  apiCallCount++;
  const timestamp = new Date().toISOString();
  console.log(`[GMAIL API ${apiCallCount}] ${timestamp} - ${method} ${endpoint} ${details}`);
};

Meteor.methods({
  'gmail.getAuthUrl'() {
    logApiCall('GET', '/auth/url', 'Generate OAuth URL');
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    return authUrl;
  },

  async 'gmail.exchangeCode'(code) {
    logApiCall('POST', '/auth/token', 'Exchange code for tokens');
    
    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      
      // Store tokens in database
      await GmailTokensCollection.upsertAsync({}, {
        $set: {
          ...tokens,
          updatedAt: new Date(),
        }
      });
      
      return { success: true };
    } catch (error) {
      console.error('[GMAIL API ERROR] OAuth2 token exchange failed:', error);
      
      // Check if it's a network error
      const errorMessage = error.message || 'Unknown error';
      const isNetworkError = errorMessage.includes('request to') && 
                            errorMessage.includes('failed') ||
                            error.code === 'ENOTFOUND' ||
                            error.code === 'ECONNREFUSED' ||
                            error.code === 'ETIMEDOUT';
      
      if (isNetworkError) {
        throw new Meteor.Error('network-error', 'Network error connecting to Google OAuth2. Please check your internet connection and try again.');
      }
      
      // Check if it's an OAuth2 error
      if (errorMessage.includes('invalid_grant') || errorMessage.includes('invalid_request')) {
        throw new Meteor.Error('oauth-invalid', 'Invalid authorization code. Please try connecting to Gmail again.');
      }
      
      // Generic error
      throw new Meteor.Error('oauth-failed', `Failed to connect to Gmail: ${errorMessage}`);
    }
  },

  async 'gmail.getTokens'() {
    logApiCall('GET', '/tokens', 'Get stored tokens from DB');
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }
    return tokenDoc;
  },

  async 'gmail.listMessages'(query = '', maxResults = 20) {
    logApiCall('GET', '/messages/list', `Query: "${query}", MaxResults: ${maxResults}`);
    
    await ensureValidTokens();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Always filter to show only inbox emails (not archived)
    const searchQuery = query ? `in:inbox ${query}` : 'in:inbox';

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: maxResults,
    });

    const messages = response.data.messages || [];
    
    // Get existing message IDs to avoid re-downloading
    const existingIds = new Set();
    const existingMessages = await GmailMessagesCollection.find({}, { fields: { id: 1 } }).fetchAsync();
    existingMessages.forEach(msg => existingIds.add(msg.id));
    
    // Process only new messages
    const newMessages = messages.filter(msg => !existingIds.has(msg.id));
    
    console.log(`[GMAIL API] Found ${messages.length} total messages, ${newMessages.length} new messages`);
    console.log(`[GMAIL API] Existing messages in DB: ${existingIds.size}`);
    
    // Process new messages to get their full content
    let successCount = 0;
    let errorCount = 0;
    const errorDetails = [];
    
    for (const message of newMessages) {
      try {
        logApiCall('GET', `/messages/${message.id}`, 'Get full message content');
        
        // Get full message content
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });
        
        const payload = messageResponse.data.payload;
        const headers = payload?.headers || [];
        
        const dateHeader = headers.find(h => h.name?.toLowerCase() === 'date');
        const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from');
        const subjectHeader = headers.find(h => h.name?.toLowerCase() === 'subject');
        const toHeader = headers.find(h => h.name?.toLowerCase() === 'to');
        
        const gmailDate = dateHeader?.value ? new Date(dateHeader.value) : new Date();
        const from = fromHeader?.value || '';
        const subject = subjectHeader?.value || '';
        const to = toHeader?.value || '';
        const snippet = messageResponse.data.snippet || '';
        const labelIds = messageResponse.data.labelIds || [];
        
        // Extract message body
        const body = extractMessageBody(payload);
        
        await GmailMessagesCollection.insertAsync({
          id: message.id,
          threadId: message.threadId,
          createdAt: new Date(),
          gmailDate: gmailDate,
          from: from,
          subject: subject,
          to: to,
          snippet: snippet,
          body: body,
          labelIds: labelIds, // Store Gmail labels (INBOX, UNREAD, etc.)
          headers: headers, // Store all headers for future use
          fullPayload: payload // Store full payload to avoid API calls
        });
        
        // Vectorize the new email for search
        try {
          const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
          const emailText = `${from} ${to} ${subject} ${snippet} ${body}`;
          await upsertDocChunks({ 
            kind: 'email', 
            id: message.id, 
            text: emailText, 
            threadId: message.threadId || null 
          });
          console.log(`[GMAIL API] Successfully vectorized message ${message.id}`);
        } catch (vectorError) {
          console.error(`[GMAIL API ERROR] Failed to vectorize message ${message.id}:`, vectorError);
          // Don't fail the whole process if vectorization fails
        }
        
        successCount++;
        console.log(`[GMAIL API] Successfully stored message ${message.id} in DB`);
      } catch (error) {
        errorCount++;
        const errorMessage = error?.message || 'Unknown error';
        const errorType = error?.error || 'unknown';
        
        console.error(`[GMAIL API ERROR] Failed to get content for message ${message.id}:`, error);
        
        // Store error details for reporting
        errorDetails.push({
          messageId: message.id,
          error: errorMessage,
          type: errorType
        });
        
        // Fallback to basic data if we can't get the full content
        await GmailMessagesCollection.insertAsync({
          id: message.id,
          threadId: message.threadId,
          createdAt: new Date(),
          gmailDate: new Date(),
          from: '',
          subject: '',
          to: '',
          snippet: '',
          body: '',
          labelIds: message.labelIds || [], // Store labels from basic message data
          headers: [],
          fullPayload: null,
          loadError: errorMessage, // Store error info for debugging
          loadErrorType: errorType
        });
        
        // Try to vectorize even with basic data (might have snippet from basic message data)
        try {
          const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
          const emailText = `${message.snippet || ''}`;
          if (emailText.trim()) {
            await upsertDocChunks({ 
              kind: 'email', 
              id: message.id, 
              text: emailText, 
              threadId: message.threadId || null 
            });
            console.log(`[GMAIL API] Successfully vectorized message ${message.id} with basic data`);
          }
        } catch (vectorError) {
          console.error(`[GMAIL API ERROR] Failed to vectorize message ${message.id} with basic data:`, vectorError);
          // Don't fail the whole process if vectorization fails
        }
      }
    }
    
    // Log summary of processing results
    console.log(`[GMAIL API] Message processing summary: ${successCount} successful, ${errorCount} errors`);
    if (errorCount > 0) {
      console.log(`[GMAIL API] Error details:`, errorDetails);
    }

    console.log(`[GMAIL API] Total API calls made: ${apiCallCount}`);
    return {
      messages: messages,
      newMessagesCount: newMessages.length,
      totalMessages: messages.length,
      successCount: successCount,
      errorCount: errorCount,
      errorDetails: errorDetails
    };
  },

  async 'gmail.getMessage'(messageId) {
    logApiCall('GET', `/messages/${messageId}`, 'Get message from DB or API');
    
    // First try to get from database
    const existingMessage = await GmailMessagesCollection.findOneAsync({ id: messageId });
    if (existingMessage?.fullPayload) {
      console.log(`[GMAIL API] Message ${messageId} found in DB (no API call needed)`);
      return {
        id: existingMessage.id,
        threadId: existingMessage.threadId,
        snippet: existingMessage.snippet,
        body: existingMessage.body,
        from: existingMessage.from,
        to: existingMessage.to,
        subject: existingMessage.subject,
        gmailDate: existingMessage.gmailDate,
        labelIds: existingMessage.labelIds || [],
        headers: existingMessage.headers,
        payload: existingMessage.fullPayload
      };
    }

    // Fallback to API call if not in database
    logApiCall('GET', `/messages/${messageId}`, 'Fallback to API call (not in DB)');
    
    await ensureValidTokens();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = response.data.payload;
    const headers = payload?.headers || [];
    
    const dateHeader = headers.find(h => h.name?.toLowerCase() === 'date');
    const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from');
    const subjectHeader = headers.find(h => h.name?.toLowerCase() === 'subject');
    const toHeader = headers.find(h => h.name?.toLowerCase() === 'to');
    
    const gmailDate = dateHeader?.value ? new Date(dateHeader.value) : new Date();
    const from = fromHeader?.value || '';
    const subject = subjectHeader?.value || '';
    const to = toHeader?.value || '';
    const snippet = response.data.snippet || '';
    const labelIds = response.data.labelIds || [];
    
    // Extract message body
    const body = extractMessageBody(payload);

    return {
      id: response.data.id,
      threadId: response.data.threadId,
      snippet: snippet,
      body: body,
      from: from,
      to: to,
      subject: subject,
      gmailDate: gmailDate,
      labelIds: labelIds,
      headers: headers,
      payload: payload
    };
  },

  async 'gmail.archiveMessage'(messageId) {
    logApiCall('POST', `/messages/${messageId}/modify`, 'Archive message');
    
    await ensureValidTokens();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      // Remove INBOX label to archive
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['INBOX'],
        },
      });

      // Remove from local collection
      await GmailMessagesCollection.removeAsync({ id: messageId });
      console.log(`[GMAIL API] Message ${messageId} archived and removed from DB`);

      return { success: true };
    } catch (error) {
      console.error(`[GMAIL API ERROR] Failed to archive message ${messageId}:`, error);
      
      // Check if it's an OAuth2/token error
      const errorMessage = error.message || 'Unknown error';
      const isOAuthError = errorMessage.includes('oauth2') || 
                          errorMessage.includes('token') || 
                          errorMessage.includes('unauthorized') ||
                          errorMessage.includes('authentication') ||
                          error.code === 401;
      
      if (isOAuthError) {
        // Clear invalid tokens
        await GmailTokensCollection.removeAsync({});
        console.log('[GMAIL API] Cleared invalid tokens due to OAuth error');
        throw new Meteor.Error('oauth-expired', 'Gmail connection expired. Please reconnect to Gmail.');
      }
      
      // Re-throw other errors
      throw new Meteor.Error('archive-failed', `Failed to archive message: ${errorMessage}`);
    }
  },

  async 'gmail.addLabel'(messageId, labelId) {
    logApiCall('POST', `/messages/${messageId}/modify`, `Add label: ${labelId}`);
    
    await ensureValidTokens();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    console.log(`[GMAIL API] Label ${labelId} added to message ${messageId}`);
    return { success: true };
  },



  // Method to get API call statistics
  'gmail.getApiStats'() {
    return {
      totalApiCalls: apiCallCount,
      timestamp: new Date().toISOString()
    };
  },

  // Method to get email statistics via RPC
  async 'gmail.getEmailStats'() {
    logApiCall('GET', '/email-stats', 'Get email statistics');
    
    try {
      // Get all messages for statistics
      const allMessages = await GmailMessagesCollection.find({}).fetchAsync();
      
      // Count inbox messages
      const inboxMessages = allMessages.filter(message => {
        const labelIds = message.labelIds || [];
        return labelIds.includes('INBOX');
      });
      
      // Count messages with errors
      const errorMessages = allMessages.filter(message => message.loadError);
      
      // Count threads (deduplicate by threadId)
      const threadIds = new Set(allMessages.map(message => message.threadId));
      
      return {
        totalMessages: allMessages.length,
        inboxMessages: inboxMessages.length,
        threads: threadIds.size,
        errorMessages: errorMessages.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[GMAIL STATS ERROR] Failed to get email statistics:', error);
      throw new Meteor.Error('stats-failed', `Failed to get email statistics: ${error.message}`);
    }
  },

  // Method to get all messages in a thread via RPC
  async 'gmail.getThreadMessages'(threadId) {
    logApiCall('GET', `/thread/${threadId}`, 'Get thread messages');
    
    try {
      // Get all messages in the thread (including archived ones)
      const threadMessages = await GmailMessagesCollection.find({
        threadId: threadId
      }, {
        sort: { gmailDate: 1 } // Sort chronologically
      }).fetchAsync();
      
      console.log(`[GMAIL THREAD] Retrieved ${threadMessages.length} messages for thread ${threadId}`);
      return threadMessages;
    } catch (error) {
      console.error('[GMAIL THREAD ERROR] Failed to get thread messages:', error);
      throw new Meteor.Error('thread-failed', `Failed to get thread messages: ${error.message}`);
    }
  },

  async 'gmail.cleanupDuplicates'() {
    logApiCall('POST', '/cleanup-duplicates', 'Clean up duplicate messages');
    
    try {
      // Get all messages
      const allMessages = await GmailMessagesCollection.find({}).fetchAsync();
      console.log(`[GMAIL CLEANUP] Found ${allMessages.length} total messages`);
      
      // Group by message ID to find duplicates
      const messageMap = new Map();
      const duplicates = [];
      
      allMessages.forEach(message => {
        if (messageMap.has(message.id)) {
          duplicates.push(message);
        } else {
          messageMap.set(message.id, message);
        }
      });
      
      console.log(`[GMAIL CLEANUP] Found ${duplicates.length} duplicate messages`);
      
      if (duplicates.length > 0) {
        // Remove duplicates (keep the first occurrence)
        const duplicateIds = duplicates.map(d => d._id);
        const result = await GmailMessagesCollection.removeAsync({ _id: { $in: duplicateIds } });
        
        console.log(`[GMAIL CLEANUP] Removed ${result} duplicate messages`);
        
        return {
          success: true,
          removedCount: result,
          totalMessages: allMessages.length,
          uniqueMessages: allMessages.length - duplicates.length
        };
      } else {
        return {
          success: true,
          removedCount: 0,
          totalMessages: allMessages.length,
          uniqueMessages: allMessages.length,
          message: 'No duplicates found'
        };
      }
    } catch (error) {
      console.error('[GMAIL CLEANUP ERROR] Failed to cleanup duplicates:', error);
      throw new Meteor.Error('cleanup-failed', `Failed to cleanup duplicates: ${error.message}`);
    }
  },


  async 'gmail.analyzeThread'(threadData) {
    logApiCall('POST', '/analyze-thread', 'Analyze email thread with AI based on preferences');
    
    // Import the LLM proxy function
    const { chatComplete } = await import('/imports/api/_shared/llmProxy.js');
    
    // Prepare the thread content for analysis
    const threadText = threadData.threadContent.map((message) => `
--- Message ${message.messageIndex} ---
From: ${message.from}
To: ${message.to}
Date: ${message.date}

Body:
${message.body}

Snippet:
${message.snippet}
    `).join('\n');
    
    const fullThreadText = `
Subject: ${threadData.subject}

Thread Content:
${threadText}
    `.trim();
    
    const system = 'You are an email thread analysis assistant. Analyze email conversations and provide structured insights including summary, key topics, decisions, and action items.';
    const userContent = `Analyze this email thread and provide:

1. Résumé de la conversation : A global summary of the exchange
2. Sujets principaux : Main themes discussed in the conversation
3. Décisions prises : Important decisions or conclusions
4. Actions/Follow-ups : Required actions, deadlines, and next steps
5. Contexte : Important information to understand the situation

Please respond in French, in plain text format (no markdown formatting).

Thread to analyze:
${fullThreadText}`;
    
    try {
      // Use AI preferences to determine provider (local/remote/auto)
      const result = await chatComplete({ 
        system, 
        messages: [{ role: 'user', content: userContent }]
        // No route override - let preferences determine the provider
      });
      
      return {
        summary: result.text,
        messageCount: threadData.threadContent.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[GMAIL API ERROR] Thread analysis failed:', error);
      throw new Meteor.Error('analysis-failed', `Thread analysis failed: ${error.message}`);
    }
  },

  async 'gmail.syncLabels'(maxMessages = 50) {
    logApiCall('POST', '/sync-labels', `Sync labels for up to ${maxMessages} messages`);
    
    await ensureValidTokens();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      // Get existing messages from database
      const existingMessages = await GmailMessagesCollection.find({}, { 
        fields: { id: 1, labelIds: 1, subject: 1 },
        limit: maxMessages,
        sort: { gmailDate: -1 } // Start with most recent messages
      }).fetchAsync();
      
      console.log(`[GMAIL SYNC] Found ${existingMessages.length} messages to sync`);
      
      let successCount = 0;
      let errorCount = 0;
      const errorDetails = [];
      
      for (const message of existingMessages) {
        try {
          logApiCall('GET', `/messages/${message.id}`, 'Sync labels');
          
          // Get current labels from Gmail API
          const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'minimal' // We only need the labels, not the full content
          });
          
          const currentLabelIds = messageResponse.data.labelIds || [];
          const storedLabelIds = message.labelIds || [];
          
          // Check if labels have changed
          const sortedCurrentLabels = [...currentLabelIds].sort((a, b) => a.localeCompare(b));
          const sortedStoredLabels = [...storedLabelIds].sort((a, b) => a.localeCompare(b));
          const labelsChanged = JSON.stringify(sortedCurrentLabels) !== JSON.stringify(sortedStoredLabels);
          
          if (labelsChanged) {
            // Update the message with new labels
            await GmailMessagesCollection.updateAsync(
              { id: message.id },
              { $set: { labelIds: currentLabelIds, labelsSyncedAt: new Date() } }
            );
            
            console.log(`[GMAIL SYNC] Updated labels for message ${message.id}: ${currentLabelIds.join(', ')}`);
          }
          
          successCount++;
        } catch (error) {
          errorCount++;
          const errorMessage = error?.message || 'Unknown error';
          const errorType = error?.error || 'unknown';
          
          console.error(`[GMAIL SYNC ERROR] Failed to sync labels for message ${message.id}:`, error);
          
          errorDetails.push({
            messageId: message.id,
            error: errorMessage,
            type: errorType
          });
        }
      }
      
      console.log(`[GMAIL SYNC] Label sync completed: ${successCount} successful, ${errorCount} errors`);
      if (errorCount > 0) {
        console.log(`[GMAIL SYNC] Error details:`, errorDetails);
      }
      
      return {
        success: true,
        processedCount: existingMessages.length,
        successCount: successCount,
        errorCount: errorCount,
        errorDetails: errorDetails
      };
    } catch (error) {
      console.error('[GMAIL SYNC ERROR] Failed to sync labels:', error);
      
      // Check if it's an OAuth2/token error
      const errorMessage = error.message || 'Unknown error';
      const isOAuthError = errorMessage.includes('oauth2') || 
                          errorMessage.includes('token') || 
                          errorMessage.includes('unauthorized') ||
                          errorMessage.includes('authentication') ||
                          error.code === 401;
      
      if (isOAuthError) {
        // Clear invalid tokens
        await GmailTokensCollection.removeAsync({});
        console.log('[GMAIL SYNC] Cleared invalid tokens due to OAuth error');
        throw new Meteor.Error('oauth-expired', 'Gmail connection expired. Please reconnect to Gmail.');
      }
      
      throw new Meteor.Error('sync-failed', `Failed to sync labels: ${errorMessage}`);
    }
  },
});

// Helper function to extract message body from payload
function extractMessageBody(payload) {
  const decodeBase64 = (data) => {
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

  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
  }
  return '';
}

// OAuth2 callback handler
WebApp.connectHandlers.use('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Error</h1><p>No authorization code provided</p></body></html>');
    return;
  }

  try {
    logApiCall('POST', '/oauth2callback', 'OAuth callback received');
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    // Store tokens in database
    await GmailTokensCollection.upsertAsync({}, {
      $set: {
        ...tokens,
        updatedAt: new Date(),
      }
    });
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body>
          <h1>Success!</h1>
          <p>Gmail has been connected successfully. You can close this window and return to Panorama.</p>
          <script>
            // Close the popup window
            window.close();
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[GMAIL API ERROR] OAuth2 callback error:', error);
    
    // Check if it's a network error
    const errorMessage = error.message || 'Unknown error';
    const isNetworkError = errorMessage.includes('request to') && 
                          errorMessage.includes('failed') ||
                          error.code === 'ENOTFOUND' ||
                          error.code === 'ECONNREFUSED' ||
                          error.code === 'ETIMEDOUT';
    
    let errorHtml = '';
    if (isNetworkError) {
      errorHtml = `
        <html>
          <body>
            <h1>Network Error</h1>
            <p>Network error connecting to Google OAuth2. Please check your internet connection and try again.</p>
            <p>Error details: ${errorMessage}</p>
          </body>
        </html>
      `;
    } else if (errorMessage.includes('invalid_grant') || errorMessage.includes('invalid_request')) {
      errorHtml = `
        <html>
          <body>
            <h1>Authorization Error</h1>
            <p>Invalid authorization code. Please try connecting to Gmail again.</p>
            <p>Error details: ${errorMessage}</p>
          </body>
        </html>
      `;
    } else {
      errorHtml = `
        <html>
          <body>
            <h1>Error</h1>
            <p>Failed to connect Gmail: ${errorMessage}</p>
          </body>
        </html>
      `;
    }
    
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(errorHtml);
  }
});