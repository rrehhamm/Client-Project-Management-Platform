import { pingDatabase } from '../../lib/db.js';
import { pingMail } from '../../lib/mailer.js';
import { pingStorage } from '../../lib/storage.js';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CHECKS = { database: pingDatabase, storage: pingStorage, mail: pingMail };

/** Runs every dependency check in parallel. Never throws. */
export async function checkReadiness() {
  const names = Object.keys(CHECKS);
  const results = await Promise.allSettled(names.map((n) => withTimeout(CHECKS[n](), CHECK_TIMEOUT_MS)));
  const checks = Object.fromEntries(names.map((n, i) => [n, results[i].status === 'fulfilled' ? 'ok' : 'error']));
  const ready = Object.values(checks).every((s) => s === 'ok');
  return { ready, checks };
}
