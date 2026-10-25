// Scheduled jobs (node-cron). Started by server.js; never during tests.
import cron from 'node-cron';
import { logger } from '../lib/logger.js';
import { purgeDeletedProjects } from './purgeDeletedProjects.js';

function run(name, fn) {
  return async () => {
    try {
      const result = await fn();
      logger.info({ job: name, result }, `Job ${name} finished`);
    } catch (err) {
      logger.error({ err, job: name }, `Job ${name} failed`);
    }
  };
}

export function startJobs() {
  const tasks = [
    // Every night at 03:15 UTC
    cron.schedule('15 3 * * *', run('purgeDeletedProjects', purgeDeletedProjects), { timezone: 'UTC' }),
  ];
  return () => tasks.forEach((t) => t.stop());
}
