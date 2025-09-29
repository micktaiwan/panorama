# Feature: Urgent Tasks Cron Job

## Description

This feature adds a cron job that runs automatically every 3 hours to analyze the user's urgent tasks and generate personalized reminders via local AI.

## Functionality

### Triggering
- **Frequency**: Every 3 hours (cron expression: `0 */3 * * *`)
- **Timezone**: Configurable via `Meteor.settings.cron.timezone` (default: `Europe/Paris`)
- **Execution mode**: Non-blocking with overlap protection

### Process

1. **Urgent tasks retrieval**
   - Filters tasks with `isUrgent: true`
   - Excludes completed tasks (`status: 'done'` or `'cancelled'`)
   - Retrieves fields: `title`, `notes`, `status`, `priorityRank`, `createdAt`, `statusChangedAt`

2. **Local AI analysis**
   - Forces local LLM usage (overrides user preferences)
   - Uses specialized productivity system prompt
   - Generates personalized reminder question starting with "Have you thought about..."

3. **User notification**
   - Creates temporary alarm to trigger existing notification system
   - Displays AI-generated question
   - Notification type: `warning` with 8-second duration

## Configuration

### Cron settings
```javascript
// settings.json
{
  "cron": {
    "timezone": "Europe/Paris"  // Timezone for crons
  }
}
```

### AI preferences
The cron job forces local LLM usage, regardless of user preferences:
- `route: 'local'` in `chatComplete()` call
- Uses local configuration defined in `AppPreferencesCollection`

## Usage

### Manual testing
```javascript
// From server console or client
Meteor.call('cron.testUrgentTasksReporting', (error, result) => {
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Result:', result);
  }
});
```

### Log verification
```bash
# Cron job logs appear in server console
[cron] Starting urgent tasks reporting...
[cron] Found X urgent tasks
[cron] Generated reminder question: Have you thought about...
[cron] Urgent tasks reminder sent to users via alarm system
```

## Example output

### Detected urgent tasks
```json
[
  {
    "title": "Prepare client presentation",
    "notes": "Deadline tomorrow 2pm",
    "status": "todo",
    "priorityRank": 0,
    "createdAt": "2024-01-15T10:00:00.000Z",
    "statusChangedAt": "2024-01-15T10:00:00.000Z"
  }
]
```

### AI-generated question
```
"Have you thought about finalizing your client presentation for tomorrow? You only have a few hours left before the 2pm deadline."
```

## Technical architecture

### Modified files
- `imports/api/cron/jobs.js`: Main cron job logic
- `server/main.js`: Cron module import (already present)

### Dependencies
- `TasksCollection`: Task access
- `AlarmsCollection`: Notification system
- `chatComplete` (llmProxy): Local AI call
- `node-cron`: Task scheduling

### Error handling
- Try-catch around entire cron job logic
- Detailed error logs on failure
- Protection against execution overlaps

## Limitations and considerations

1. **Performance**: Cron job runs even if no urgent tasks exist
2. **Notifications**: Uses existing alarm system (may be limited by user preferences)
3. **Local AI**: Requires local LLM to be available and functional
4. **Urgent tasks**: Only based on `isUrgent: true` field

## Future improvements

1. **Smart filtering**: Consider due dates
2. **Customization**: Allow cron frequency configuration
3. **History**: Save generated questions
4. **Analytics**: Measure reminder effectiveness
