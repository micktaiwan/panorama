# Gmail Integration Setup

This document explains how to set up Gmail OAuth2 integration for the Emails page in Panorama.

## Prerequisites

1. A Google Cloud Project with Gmail API enabled
2. OAuth2 credentials configured for a Desktop application

## Google Cloud Console Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API"
   - Click on it and press "Enable"

4. Create OAuth2 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Select "Desktop application" as the application type
   - Give it a name (e.g., "Panorama Gmail Integration")
   - Click "Create"

5. Note down the Client ID and Client Secret

## Panorama Configuration

1. Open `settings.json` in the project root
2. Update the Gmail configuration with your credentials:

```json
{
  "gmail": {
    "clientId": "your-actual-client-id.apps.googleusercontent.com",
    "clientSecret": "your-actual-client-secret"
  }
}
```

3. Restart the Meteor application:
   ```bash
   npm run start
   ```

## Usage

1. Navigate to the Emails page in Panorama (or use Cmd/Ctrl+G and type "emails")
2. Click "Connect Gmail" to start the OAuth flow
3. A popup window will open asking for Gmail permissions
4. Grant the requested permissions (read-only and modify)
5. The popup will close automatically and you'll be redirected back to Panorama
6. Your emails will now be loaded and displayed

## Features

- **View emails**: See the last 20 emails with sender, subject, date, and snippet
- **Search**: Use the search bar to filter emails using Gmail search syntax
- **Open**: Click "Open" to view the full email content in a modal
- **Archive**: Click "Archive" to remove the email from your inbox
- **Labels**: Click "Mark Important" to add the IMPORTANT label to an email

## Security Notes

- OAuth2 tokens are stored locally in your MongoDB database
- The integration only requests read and modify permissions for Gmail
- No email content is stored permanently - it's fetched on-demand from Gmail
- The OAuth2 flow uses a popup window for security

## Troubleshooting

- If the OAuth popup is blocked, allow popups for localhost:3000
- If you get "redirect_uri_mismatch" error, ensure your OAuth2 credentials are configured for "Desktop application" type
- If emails don't load, check the browser console for error messages
- Make sure the Gmail API is enabled in your Google Cloud project
