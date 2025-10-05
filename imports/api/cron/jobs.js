import { Meteor } from 'meteor/meteor';
import cron from 'node-cron';
import { TasksCollection } from '/imports/api/tasks/collections';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { GmailMessagesCollection } from '/imports/api/emails/collections';
import { suggestCtaInternal } from '/imports/api/emails/methods';

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

    const tasksContext = urgentTasks.map(task => ({
      title: task.title || 'Untitled',
      notes: task.notes || '',
      status: task.status || 'todo',
      priorityRank: task.priorityRank || 0,
      createdAt: task.createdAt,
      statusChangedAt: task.statusChangedAt
    }));

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
      route: 'local',
      temperature: 0.7,
      maxTokens: 150
    });

    const reminderQuestion = response?.content?.trim();
    
    if (reminderQuestion) {
      console.log('[cron] Generated reminder question:', reminderQuestion);
      
      const now = new Date();
      const alarmData = {
        title: reminderQuestion,
        enabled: true,
        nextTriggerAt: now,
        recurrence: { type: 'none' },
        done: false,
        userId: null,
        createdAt: now,
        updatedAt: now
      };
      
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      const alarmId = await AlarmsCollection.insertAsync(alarmData);
      
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

async function prepareEmailCta() {
  console.log('[cron] Starting email CTA preparation...');
  
  try {
    // Check if we already have 20 prepared emails
    const preparedCount = await GmailMessagesCollection.find({
      ctaPrepared: true
    }).countAsync();
    
    if (preparedCount >= 20) {
      console.log(`[cron] Already have ${preparedCount} prepared emails, skipping`);
      return;
    }
    
    // Check if any email is currently being prepared
    const preparingCount = await GmailMessagesCollection.find({
      ctaPreparing: true
    }).countAsync();
    
    if (preparingCount > 0) {
      console.log(`[cron] ${preparingCount} emails currently being prepared, skipping`);
      return;
    }
    
    // Find the most recent email in Inbox that needs CTA preparation
    const candidateEmail = await GmailMessagesCollection.findOneAsync({
      labelIds: { $in: ['INBOX'] },
      ctaPrepared: { $ne: true },
      ctaPreparing: { $ne: true }
    }, {
      sort: { gmailDate: -1 },
      fields: { _id: 1, subject: 1, from: 1 }
    });
    
    if (!candidateEmail) {
      console.log('[cron] No candidate emails found for CTA preparation');
      return;
    }
    
    console.log(`[cron] Preparing CTA for email: ${candidateEmail.subject} from ${candidateEmail.from}`);
    
    // Call the internal suggestCta function directly
    const result = await suggestCtaInternal(candidateEmail._id);
    
    if (result.success) {
      console.log(`[cron] Successfully prepared CTA for email ${candidateEmail._id}: ${result.suggestion.action}`);
    } else if (result.alreadyPrepared || result.alreadyPreparing) {
      console.log(`[cron] Email ${candidateEmail._id} already prepared/preparing`);
    } else {
      console.log(`[cron] Failed to prepare CTA for email ${candidateEmail._id}`);
    }
    
  } catch (error) {
    console.error('[cron] Error in email CTA preparation:', error);
  }
}

function registerJobs() {
  const cronSettings = Meteor.settings?.cron || {};
  const timezone = cronSettings.timezone || 'Europe/Paris';
  
  scheduleNoOverlap(
    'urgent-tasks-reporting',
    '0 */3 * * *',
    timezone,
    urgentTasksReporting
  );
  
  scheduleNoOverlap(
    'email-cta-preparation',
    '* * * * *', // Every minute
    timezone,
    prepareEmailCta
  );
  
  console.log('[cron] Jobs registered - urgent tasks reporting every 3 hours, email CTA preparation every minute');
}

Meteor.methods({
  async 'cron.testUrgentTasksReporting'() {
    console.log('[cron] Manual trigger of urgent tasks reporting...');
    await urgentTasksReporting();
    return { success: true, message: 'Urgent tasks reporting executed manually' };
  },
  
  async 'cron.testEmailCtaPreparation'() {
    console.log('[cron] Manual trigger of email CTA preparation...');
    await prepareEmailCta();
    return { success: true, message: 'Email CTA preparation executed manually' };
  }
});

Meteor.startup(() => {
  if (cronJobsStarted) return;
  cronJobsStarted = true;
  //registerJobs();
});
