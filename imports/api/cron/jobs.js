import { Meteor } from 'meteor/meteor';
import cron from 'node-cron';

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

function registerJobs() {
  const cronSettings = Meteor.settings?.cron || {};
  const timezone = cronSettings.timezone || 'Europe/Paris';
  void cronSettings; // placeholder until real jobs are added
  void timezone;
}

Meteor.startup(() => {
  if (cronJobsStarted) return;
  cronJobsStarted = true;
  registerJobs();
});


