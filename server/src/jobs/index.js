// Scheduled jobs (node-cron and a short interval). Started by server.js; never during tests.
import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { purgeDeletedFiles, rescanPending } from '../modules/files/service.js';
import { sendApprovalReminders } from '../modules/approvals/service.js';
import { notifyDueTomorrow } from './dueTomorrow.js';
import { sendPendingEmails } from './outbox.js';
import { purgeDeletedProjects } from './purgeDeletedProjects.js';

function run(name, fn, { quiet = false } = {}) {
  let busy = false; // never overlap a slow run with the next one
  return async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await fn();
      if (!quiet || result) logger.info({ job: name, result }, `Job ${name} finished`);
    } catch (err) {
      logger.error({ err, job: name }, `Job ${name} failed`);
    } finally {
      busy = false;
    }
  };
}

export function startJobs() {
  const tasks = [
    // Every night at 03:15 UTC: projects and files deleted more than 30 days ago
    cron.schedule('15 3 * * *', run('purgeDeletedProjects', purgeDeletedProjects), { timezone: 'UTC' }),
    cron.schedule('30 3 * * *', run('purgeDeletedFiles', purgeDeletedFiles), { timezone: 'UTC' }),
    // FR-NOT-02 "due tomorrow" at 08:00 workspace time (checked hourly)
    cron.schedule('5 * * * *', run('notifyDueTomorrow', () => notifyDueTomorrow()), { timezone: 'UTC' }),
    // FR-APP-07: approval reminders one day before and on the due date (each sent once)
    cron.schedule('10 * * * *', run('sendApprovalReminders', () => sendApprovalReminders()), { timezone: 'UTC' }),
    // BR-FILE-02: retry scans that failed because the scanner was down
    cron.schedule('* * * * *', run('rescanPending', () => rescanPending(), { quiet: true }), { timezone: 'UTC' }),
  ];
  // FR-NOT-02 email outbox
  const outbox = setInterval(run('sendPendingEmails', () => sendPendingEmails(), { quiet: true }), config.outboxIntervalSeconds * 1000);
  return () => {
    tasks.forEach((t) => t.stop());
    clearInterval(outbox);
  };
}
