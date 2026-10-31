// FR-NOT-02 "due tomorrow": at 08:00 workspace time, assignees of open tasks due
// tomorrow get one notification per task. Runs hourly; the hour check and the
// "already sent for this due date" check make it safe to run more often.
import { TASK_STATUS } from '@cpm/shared';
import { addDays, toDbDate, workspaceToday } from '../lib/dates.js';
import { db } from '../lib/db.js';
import { notify } from '../lib/notify.js';

export const SEND_HOUR = 8;

const localHour = (timeZone, now) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));

export async function notifyDueTomorrow(now = new Date(), { force = false } = {}) {
  const workspaces = await db.workspace.findMany({ select: { id: true, timezone: true } });
  let notified = 0;
  for (const ws of workspaces) {
    if (!force && localHour(ws.timezone, now) !== SEND_HOUR) continue;
    const tomorrow = addDays(workspaceToday(ws, now), 1);
    const tasks = await db.task.findMany({
      where: {
        workspace_id: ws.id,
        deleted_at: null,
        due_date: toDbDate(tomorrow),
        status: { notIn: [TASK_STATUS.DONE, TASK_STATUS.CANCELLED] },
        project: { deleted_at: null, archived_at: null },
        assignees: { some: {} },
      },
      include: { assignees: { select: { user_id: true } }, project: { select: { code: true } } },
    });
    for (const task of tasks) {
      const already = await db.notification.findFirst({ where: { type: 'task_due_tomorrow', entity_id: task.id, payload: { path: ['due_date'], equals: tomorrow } }, select: { id: true } });
      if (already) continue;
      notified += await notify(db, {
        workspaceId: ws.id,
        event: 'task_due_tomorrow',
        userIds: task.assignees.map((a) => a.user_id),
        internal: true,
        entityType: 'Task',
        entityId: task.id,
        payload: {
          title: `"${task.title}" is due tomorrow`,
          subject: `Due tomorrow: ${task.title}`,
          text: `${task.project.code} · "${task.title}" is due tomorrow (${tomorrow}).`,
          link: `/projects/${task.project_id}?tab=tasks&task=${task.id}`,
          due_date: tomorrow,
        },
      });
    }
  }
  return notified;
}
