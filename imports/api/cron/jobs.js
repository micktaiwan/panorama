import { Meteor } from 'meteor/meteor';
import cron from 'node-cron';
import { TasksCollection } from '/imports/api/tasks/collections';
import { chatComplete } from '/imports/api/_shared/llmProxy';

let cronJobsStarted = false;
const jobLocks = new Map();

function scheduleNoOverlap(name, expression, timezone, task) {
  const run = async () => {
    if (jobLocks.get(name)) return;
    jobLocks.set(name, true);
    try {
      await Promise.resolve(task());
    } finally {
      jobLocks.delete(name);
    }
  };

  cron.schedule(expression, run, { timezone });
}

async function urgentTasksReporting() {
  console.log('[cron] Starting urgent tasks reporting...');
  
  try {
    // Get all non-completed urgent tasks
    const urgentTasks = await TasksCollection.find({
      isUrgent: true,
      $or: [
        { status: { $exists: false } },
        { status: { $nin: ['done', 'cancelled'] } }
      ]
    }, {
      fields: {
        title: 1,
        notes: 1,
        status: 1,
        priorityRank: 1,
        createdAt: 1,
        statusChangedAt: 1
      }
    }).fetchAsync();

    if (urgentTasks.length === 0) {
      console.log('[cron] No urgent tasks found');
      return;
    }

    console.log(`[cron] Found ${urgentTasks.length} urgent tasks`);

    // Prepare context for AI analysis
    const tasksContext = urgentTasks.map(task => ({
      title: task.title || 'Untitled',
      notes: task.notes || '',
      status: task.status || 'todo',
      priorityRank: task.priorityRank || 0,
      createdAt: task.createdAt,
      statusChangedAt: task.statusChangedAt
    }));

    // Call local LLM to analyze urgent tasks
    const systemPrompt = `You are a productivity assistant. Analyze the user's urgent tasks and generate a personalized reminder question that starts with "Have you thought about...".

Rules:
- Be concise and direct
- Ask a question that helps the user focus on the most important action
- Use a supportive but firm tone
- The question must be relevant to the urgent tasks
- Maximum 2 sentences

Urgent tasks to analyze:
${JSON.stringify(tasksContext, null, 2)}`;

    const response = await chatComplete({
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: 'Generate a reminder question based on my urgent tasks.'
      }],
      route: 'local', // Force local LLM usage
      temperature: 0.7,
      maxTokens: 150
    });

    const reminderQuestion = response?.content?.trim();
    
    if (reminderQuestion) {
      console.log('[cron] Generated reminder question:', reminderQuestion);
      
      // Create temporary alarm to trigger notification
      const now = new Date();
      const alarmData = {
        title: reminderQuestion,
        enabled: true,
        nextTriggerAt: now,
        recurrence: { type: 'none' },
        done: false,
        userId: null, // Global notification
        createdAt: now,
        updatedAt: now
      };
      
      // Insert alarm that will be automatically handled by existing system
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      const alarmId = await AlarmsCollection.insertAsync(alarmData);
      
      // Mark alarm as fired immediately
      await AlarmsCollection.updateAsync(alarmId, {
        $set: {
          lastFiredAt: now,
          enabled: false,
          done: true,
          acknowledgedAt: null
        }
      });
      
      console.log('[cron] Urgent tasks reminder sent to users via alarm system');
    } else {
      console.log('[cron] No reminder question generated');
    }

  } catch (error) {
    console.error('[cron] Error in urgent tasks reporting:', error);
  }
}

function registerJobs() {
  const cronSettings = Meteor.settings?.cron || {};
  const timezone = cronSettings.timezone || 'Europe/Paris';
  
  // Cron job for urgent tasks - every 3 hours
  scheduleNoOverlap(
    'urgent-tasks-reporting',
    '0 */3 * * *', // Every 3 hours
    timezone,
    urgentTasksReporting
  );
  
  console.log('[cron] Jobs registered - urgent tasks reporting every 3 hours');
}

// Test method to manually trigger the cron job
Meteor.methods({
  async 'cron.testUrgentTasksReporting'() {
    console.log('[cron] Manual trigger of urgent tasks reporting...');
    await urgentTasksReporting();
    return { success: true, message: 'Urgent tasks reporting executed manually' };
  }
});

Meteor.startup(() => {
  if (cronJobsStarted) return;
  cronJobsStarted = true;
  registerJobs();
});


