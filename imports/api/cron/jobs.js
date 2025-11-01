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

async function prepareEmailCtaMorningBatch() {
  console.log('[cron] Starting morning email batch analysis (5 emails max)...');

  try {
    // Find up to 5 unread emails in inbox that haven't been prepared
    const candidateEmails = await GmailMessagesCollection.find({
      labelIds: { $all: ['INBOX', 'UNREAD'] },
      ctaPrepared: { $ne: true }
    }, {
      sort: { gmailDate: -1 },
      limit: 5,
      fields: { _id: 1, subject: 1, from: 1 }
    }).fetchAsync();

    if (candidateEmails.length === 0) {
      console.log('[cron] No unread emails to analyze');
      // Create alarm even if no emails
      const now = new Date();
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      await AlarmsCollection.insertAsync({
        title: '📧 Inbox Zero: Aucun email non lu à analyser',
        enabled: true,
        nextTriggerAt: now,
        recurrence: { type: 'none' },
        done: false,
        userId: null,
        createdAt: now,
        updatedAt: now
      });
      return;
    }

    console.log(`[cron] Analyzing ${candidateEmails.length} emails with remote LLM...`);

    const results = { delete: 0, archive: 0, reply: 0, errors: 0 };

    // Analyze each email with remote LLM (OpenAI)
    for (const email of candidateEmails) {
      try {
        const result = await suggestCtaInternal(email._id);
        if (result.success && result.suggestion) {
          const action = result.suggestion.action;
          if (action in results) {
            results[action]++;
          }
          console.log(`[cron] Email "${email.subject}" → ${action}`);
        } else if (result.alreadyPrepared) {
          console.log(`[cron] Email "${email.subject}" already prepared`);
        }
      } catch (error) {
        console.error(`[cron] Error analyzing email ${email._id}:`, error);
        results.errors++;
      }
    }

    // Create alarm with summary
    const totalAnalyzed = results.delete + results.archive + results.reply;
    let summary = `📧 ${candidateEmails.length} email${candidateEmails.length > 1 ? 's' : ''} analysé${candidateEmails.length > 1 ? 's' : ''}`;

    if (totalAnalyzed > 0) {
      const parts = [];
      if (results.archive > 0) parts.push(`${results.archive} à archiver`);
      if (results.reply > 0) parts.push(`${results.reply} à répondre`);
      if (results.delete > 0) parts.push(`${results.delete} à supprimer`);
      summary += ': ' + parts.join(', ');
    }

    if (results.errors > 0) {
      summary += ` (${results.errors} erreur${results.errors > 1 ? 's' : ''})`;
    }

    const now = new Date();
    const { AlarmsCollection } = await import('/imports/api/alarms/collections');
    await AlarmsCollection.insertAsync({
      title: summary,
      enabled: true,
      nextTriggerAt: now,
      recurrence: { type: 'none' },
      done: false,
      userId: null,
      createdAt: now,
      updatedAt: now
    });

    console.log('[cron] Morning batch completed, alarm created:', summary);

  } catch (error) {
    console.error('[cron] Error in morning email batch:', error);

    // Create error alarm
    try {
      const now = new Date();
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      await AlarmsCollection.insertAsync({
        title: `⚠️ Erreur lors de l'analyse des emails: ${error.message}`,
        enabled: true,
        nextTriggerAt: now,
        recurrence: { type: 'none' },
        done: false,
        userId: null,
        createdAt: now,
        updatedAt: now
      });
    } catch (alarmError) {
      console.error('[cron] Failed to create error alarm:', alarmError);
    }
  }
}

function registerJobs() {
  const cronSettings = Meteor.settings?.cron || {};
  const timezone = cronSettings.timezone || 'Europe/Paris';

  scheduleNoOverlap(
    'urgent-tasks-reporting',
    '0 9 * * 1-5', // Monday to Friday at 9:00 AM
    timezone,
    urgentTasksReporting
  );

  scheduleNoOverlap(
    'email-morning-batch',
    '0 9 * * 1-5', // Monday to Friday at 9:00 AM
    timezone,
    prepareEmailCtaMorningBatch
  );

  console.log('[cron] Jobs registered - urgent tasks and email batch on weekdays at 9:00 AM');
}

Meteor.methods({
  async 'cron.testUrgentTasksReporting'() {
    console.log('[cron] Manual trigger of urgent tasks reporting...');
    await urgentTasksReporting();
    return { success: true, message: 'Urgent tasks reporting executed manually' };
  },

  async 'cron.testMorningEmailBatch'() {
    console.log('[cron] Manual trigger of morning email batch...');
    await prepareEmailCtaMorningBatch();
    return { success: true, message: 'Morning email batch executed manually' };
  }
});

Meteor.startup(() => {
  if (cronJobsStarted) return;
  cronJobsStarted = true;
  registerJobs();
});
