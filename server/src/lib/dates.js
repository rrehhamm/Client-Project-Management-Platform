// Date-only fields are stored as SQL DATE (midnight UTC in JS) and exchanged as
// "YYYY-MM-DD" (BR-PRJ-07). "Today" is the workspace's calendar day (NFR-TZ-01).
import { todayInTimeZone } from '@cpm/shared';

/** "2026-11-10" → Date for a @db.Date column. null/undefined pass through. */
export function toDbDate(iso) {
  if (iso === null || iso === undefined) return iso;
  return new Date(`${iso}T00:00:00Z`);
}

/** Date from a @db.Date column → "2026-11-10" (or null). */
export function fromDbDate(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Today's date in the workspace timezone, as "YYYY-MM-DD". */
export function workspaceToday(workspace, now = new Date()) {
  return todayInTimeZone(workspace.timezone, now);
}

/** ISO date + n days. */
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** BR-DASH-02: "this week" in the workspace timezone and week start day. */
export function workspaceWeek(workspace, now = new Date()) {
  const today = workspaceToday(workspace, now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sinceStart = (dow - workspace.week_start_day + 7) % 7;
  const weekStart = addDays(today, -sinceStart);
  return { today, weekStart, weekEnd: addDays(weekStart, 6) };
}
