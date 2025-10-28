# Google Calendar API Integration

## Overview

Panorama now integrates directly with the Google Calendar API via OAuth2, providing access to detailed calendar data including:

- Full event details (title, description, location)
- Attendees list and RSVP status
- Conference/Meet links with join buttons
- Event organizer information
- Event visibility and status
- Multiple calendar support

This replaces the limited ICS URL sync which only provided basic busy/not-busy information.

## Setup

### 1. Configuration

The OAuth2 credentials are already configured in `settings.json`:

```json
{
  "googleCalendar": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "redirectUri": "http://localhost:3000/oauth/google-calendar/callback",
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }
}
```

### 2. First-Time OAuth Flow (if needed)

If you need to re-authenticate or connect a different account:

1. Go to Preferences → Google Calendar API section
2. Enter your Client ID and Client Secret
3. Click "Connect Google Calendar"
4. Authorize in the popup window
5. The refresh token will be automatically saved

### 3. Syncing Calendar Events

Two ways to sync:

**From Preferences:**
- Go to Preferences → Google Calendar API
- Click "Sync Now" button

**From Calendar Page:**
- Go to Calendar page (`#/calendar`)
- Click "Sync events" button

The sync will:
- Fetch events from all selected calendars
- Import 7 days of history + 90 days ahead
- Store detailed metadata (attendees, conference data, etc.)
- Clean up events older than 90 days

## Features

### Calendar Page Enhancements

Events now display:
- **Title, time, and duration** as before
- **Location** if specified
- **Attendee count** (e.g., "· 3 attendees")
- **Join button** for Google Meet/video conferences
- **View button** linking to event in Google Calendar

### Smart Task Scheduling

The calendar page intelligently suggests task scheduling slots by:
- Analyzing busy/free windows from all synced events
- Considering scheduled tasks as busy time
- Avoiding lunch break (12:00-14:00)
- Prioritizing by urgency, importance, and deadline
- Requesting time estimates for unestimated tasks

### Multiple Calendar Support

The sync automatically includes all calendars that are "selected" in your Google Calendar. To sync specific calendars only, pass calendar IDs:

```javascript
Meteor.call('calendar.google.sync', ['primary', 'work@example.com'], callback);
```

## Architecture

### Server-Side Components

**`imports/api/calendar/googleCalendarClient.js`**
- OAuth2 client initialization
- Auth URL generation
- Token exchange

**`imports/api/calendar/methods.js`**
- `calendar.google.getAuthUrl()` - Generate OAuth URL
- `calendar.google.saveTokens(code)` - Exchange code for tokens
- `calendar.google.sync(calendarIds)` - Sync events from Google
- `calendar.google.listCalendars()` - List available calendars

**`imports/api/_shared/config.js`**
- `getGoogleCalendarConfig()` - Resolve credentials from settings/env/prefs

**`server/main.js`**
- OAuth callback route at `/oauth/google-calendar/callback`

### Client-Side Components

**`imports/ui/Calendar/CalendarPage.jsx`**
- Enhanced event display with attendees and conference links
- Changed sync to use `calendar.google.sync` instead of ICS

**`imports/ui/Preferences/Preferences.jsx`**
- OAuth connection UI
- Sync status and last sync time
- Manual sync trigger

### Data Model

CalendarEvents collection now includes:
```javascript
{
  uid: String,           // Event ID from Google
  title: String,
  description: String,
  location: String,
  start: Date,
  end: Date,
  allDay: Boolean,
  source: 'google',      // vs 'ics'
  calendarId: String,    // Which calendar this came from
  htmlLink: String,      // Link to event in Google Calendar
  status: String,        // confirmed/tentative/cancelled
  attendees: [{
    email: String,
    displayName: String,
    responseStatus: String,
    organizer: Boolean,
    self: Boolean
  }],
  organizer: {
    email: String,
    displayName: String,
    self: Boolean
  },
  conferenceData: {
    entryPoints: [{
      entryPointType: String,  // video/phone/more
      uri: String,
      label: String
    }]
  },
  transparency: String,  // opaque/transparent
  visibility: String,    // default/public/private
  colorId: String,
  created: Date,
  updated: Date
}
```

## API Methods

### `calendar.google.sync(calendarIds)`

Syncs events from Google Calendar API.

**Parameters:**
- `calendarIds` (optional): Array of calendar IDs to sync. If not provided, syncs all selected calendars.

**Returns:**
```javascript
{ ok: true, upserts: 42, calendars: 3 }
```

### `calendar.google.listCalendars()`

Lists all calendars accessible to the authenticated user.

**Returns:**
```javascript
{
  calendars: [{
    id: 'primary',
    summary: 'My Calendar',
    description: '...',
    primary: true,
    selected: true,
    backgroundColor: '#9fc6e7',
    foregroundColor: '#000000'
  }]
}
```

### `calendar.google.getAuthUrl()`

Generates OAuth2 authorization URL.

**Returns:**
```javascript
{ url: 'https://accounts.google.com/o/oauth2/auth?...' }
```

### `calendar.google.saveTokens(code)`

Exchanges OAuth code for refresh token and saves to preferences.

**Parameters:**
- `code`: Authorization code from OAuth callback

## Environment Variables

Alternative to `settings.json`:

```bash
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REFRESH_TOKEN=...
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/oauth/google-calendar/callback
```

## Migration from ICS

The legacy ICS sync is still available in Preferences under "Google Calendar (Legacy ICS)" for backward compatibility. However, it provides limited data (no attendees, no conference links, etc.).

To migrate:
1. Set up Google Calendar API as described above
2. Run first sync via "Sync Now" button
3. Verify events appear with full details in Calendar page
4. Old ICS-sourced events will be gradually replaced as you sync

## Troubleshooting

### "OAuth Error" or "Failed to complete OAuth"

- Verify Client ID and Client Secret are correct
- Ensure redirect URI matches exactly: `http://localhost:3000/oauth/google-calendar/callback`
- Check Google Cloud Console that Calendar API is enabled

### "Sync failed" error

- Check refresh token is valid (may expire after 6 months of inactivity)
- Verify network connectivity to Google APIs
- Check server logs for detailed error messages

### Events not showing up

- Verify calendar is marked as "selected" in Google Calendar settings
- Check time range (events older than 7 days or beyond 90 days won't sync)
- Ensure events have valid start/end times

## Future Enhancements

Potential improvements:
- **Write access**: Create/modify events from Panorama
- **Real-time sync**: Use Google Calendar webhooks for push notifications
- **Calendar selection UI**: Choose which calendars to sync in Preferences
- **Conflict detection**: Warn when scheduling tasks over existing events
- **Smart suggestions**: ML-based task scheduling recommendations
