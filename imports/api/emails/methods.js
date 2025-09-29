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

Meteor.methods({
  'gmail.getAuthUrl'() {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    return authUrl;
  },

  async 'gmail.exchangeCode'(code) {
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
  },

  async 'gmail.getTokens'() {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }
    return tokenDoc;
  },

  async 'gmail.listMessages'(query = '', maxResults = 20) {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
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
    
    console.log(`Found ${messages.length} total messages, ${newMessages.length} new messages`);
    
    // Process new messages to get their full content
    for (const message of newMessages) {
      try {
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
          headers: headers, // Store all headers for future use
          fullPayload: payload // Store full payload to avoid API calls
        });
      } catch (error) {
        console.error(`Failed to get content for message ${message.id}:`, error);
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
          headers: [],
          fullPayload: null
        });
      }
    }

    return messages;
  },

  async 'gmail.getMessage'(messageId) {
    // First try to get from database
    const existingMessage = await GmailMessagesCollection.findOneAsync({ id: messageId });
    if (existingMessage?.fullPayload) {
      return {
        id: existingMessage.id,
        threadId: existingMessage.threadId,
        snippet: existingMessage.snippet,
        payload: existingMessage.fullPayload
      };
    }

    // Fallback to API call if not in database
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    return response.data;
  },

  async 'gmail.archiveMessage'(messageId) {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

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

    return { success: true };
  },

  async 'gmail.addLabel'(messageId, labelId) {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    return { success: true };
  },

  async 'gmail.removeLabel'(messageId, labelId) {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [labelId],
      },
    });

    return { success: true };
  },

  async 'gmail.getLabels'() {
    const tokenDoc = await GmailTokensCollection.findOneAsync({});
    if (!tokenDoc) {
      throw new Meteor.Error('not-authorized', 'Gmail not connected');
    }

    oauth2Client.setCredentials(tokenDoc);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.labels.list({
      userId: 'me',
    });

    return response.data.labels || [];
  },
});

// Helper function to extract message body from payload
function extractMessageBody(payload) {
  if (payload.body?.data) {
    return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
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
    console.error('OAuth2 callback error:', error);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body>
          <h1>Error</h1>
          <p>Failed to connect Gmail: ${error.message}</p>
        </body>
      </html>
    `);
  }
});