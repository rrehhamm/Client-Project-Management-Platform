// FR-PRJ-11: soft-deleted projects are restorable for 30 days, then removed for good.
// Projects with time entries or invoices can never be deleted, so they never reach here.
import { writeAudit } from '../lib/audit.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { deleteObject } from '../lib/storage.js';
import { removeFilesForGood } from '../modules/files/service.js';

export const PURGE_AFTER_DAYS = 30;

/** Hard-delete projects soft-deleted more than 30 days ago. Returns the number removed. */
export async function purgeDeletedProjects(now = new Date()) {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.project.findMany({ where: { deleted_at: { lt: cutoff } }, select: { id: true, workspace_id: true, client_id: true, code: true, name: true } });
  let removed = 0;
  const storedKeys = [];
  for (const p of due) {
    const keys = await db.$transaction(async (tx) => {
      const [time, invoices] = await Promise.all([
        tx.timeEntry.count({ where: { project_id: p.id } }),
        tx.invoice.count({ where: { project_id: p.id } }),
      ]);
      if (time + invoices > 0) return []; // safety net: never purge billable history
      const taskIds = (await tx.task.findMany({ where: { project_id: p.id }, select: { id: true } })).map((t) => t.id);
      const fileIds = (await tx.file.findMany({ where: { project_id: p.id }, select: { id: true } })).map((f) => f.id);
      await tx.approvalRequest.deleteMany({ where: { project_id: p.id } });
      await tx.comment.updateMany({ where: { project_id: p.id }, data: { parent_comment_id: null } });
      await tx.comment.deleteMany({ where: { project_id: p.id } }); // mentions and attachments cascade
      const fileKeys = await removeFilesForGood(fileIds, tx); // FR-PRJ-11: rows, quota
      await tx.task.updateMany({ where: { id: { in: taskIds } }, data: { parent_task_id: null } });
      await tx.task.deleteMany({ where: { project_id: p.id } });
      await tx.milestone.deleteMany({ where: { project_id: p.id } });
      await tx.proposal.updateMany({ where: { project_id: p.id }, data: { project_id: null } });
      await tx.contract.updateMany({ where: { project_id: p.id }, data: { project_id: null } });
      await tx.project.delete({ where: { id: p.id } }); // members cascade
      await writeAudit(
        { workspaceId: p.workspace_id, action: 'project.purged', entityType: 'Project', entityId: p.id, projectId: p.id, clientId: p.client_id, before: { code: p.code, name: p.name } },
        tx,
      );
      removed += 1;
      return fileKeys;
    });
    storedKeys.push(...keys);
  }
  // FR-PRJ-11: stored objects go after their rows are gone
  await Promise.all(storedKeys.map((k) => deleteObject(k).catch((err) => logger.warn({ err, key: k }, 'Could not remove stored object'))));
  return removed;
}
