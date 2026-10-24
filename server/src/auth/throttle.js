// FR-AUTH-11: 5 failed logins for one email within 15 minutes lock that email for
// 15 minutes. Works the same whether or not the account exists.
import { db } from '../lib/db.js';

export const MAX_FAILURES = 5;
export const WINDOW_MINUTES = 15;
export const LOCK_MINUTES = 15;

/** Date until which the email is locked, or null. */
export async function lockedUntil(email) {
  const row = await db.loginThrottle.findUnique({ where: { email }, select: { locked_until: true } });
  return row?.locked_until && row.locked_until.getTime() > Date.now() ? row.locked_until : null;
}

/**
 * Count one failure atomically. Starts a new window if the last one is older than
 * 15 minutes. Returns { failedCount, lockedUntil, justLocked }.
 */
export async function recordFailure(email, workspaceId) {
  const [row] = await db.$queryRaw`
    INSERT INTO login_throttles (id, workspace_id, email, failed_count, window_started_at, updated_at)
    VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${email}, 1, now(), now())
    ON CONFLICT (email) DO UPDATE SET
      failed_count = CASE
        WHEN login_throttles.window_started_at < now() - make_interval(mins => ${WINDOW_MINUTES})
        THEN 1 ELSE login_throttles.failed_count + 1 END,
      window_started_at = CASE
        WHEN login_throttles.window_started_at < now() - make_interval(mins => ${WINDOW_MINUTES})
        THEN now() ELSE login_throttles.window_started_at END,
      updated_at = now()
    RETURNING failed_count`;
  if (row.failed_count < MAX_FAILURES) return { failedCount: row.failed_count, lockedUntil: null, justLocked: false };

  const until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
  // Start a fresh count after the lock so the next attempt after it gets 5 tries again.
  await db.loginThrottle.update({
    where: { email },
    data: { locked_until: until, failed_count: 0, window_started_at: until },
  });
  return { failedCount: row.failed_count, lockedUntil: until, justLocked: true };
}

export async function clearFailures(email) {
  await db.loginThrottle.deleteMany({ where: { email } });
}
