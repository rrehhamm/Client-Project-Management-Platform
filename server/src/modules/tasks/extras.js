// Checklist items (FR-TSK-05), dependencies (FR-TSK-07) and bulk actions (FR-TSK-11).
import { can } from '../../auth/can.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, fieldError, notFound, staleUpdate } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { ERROR_CODES } from '@cpm/shared';
import { assertTasksWritable, loadTaskContext } from './common.js';
import * as service from './service.js';

// ---------------------------------------------------------------------------
// Checklist (FR-TSK-05): does not affect progress
// ---------------------------------------------------------------------------

const itemDto = (i) => ({ id: i.id, text: i.text, is_done: i.is_done, sort_order: i.sort_order, version: i.version });

export async function addChecklistItem(viewer, ctx, { text }, req) {
  assertTasksWritable(ctx.project);
  const last = await db.taskChecklistItem.aggregate({ where: { task_id: ctx.task.id }, _max: { sort_order: true } });
  const item = await db.taskChecklistItem.create({
    data: { workspace_id: ctx.task.workspace_id, task_id: ctx.task.id, text, sort_order: (last._max.sort_order ?? -1) + 1, created_by: viewer.id, updated_by: viewer.id },
  });
  await writeAudit({ req, action: 'task.checklist_added', entityType: 'Task', entityId: ctx.task.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { text } });
  return itemDto(item);
}

export async function findChecklistItem(ctx, itemId) {
  const item = isUuid(itemId) ? await db.taskChecklistItem.findFirst({ where: { id: itemId, task_id: ctx.task.id } }) : null;
  if (!item) throw notFound('Checklist item not found');
  return item;
}

export async function updateChecklistItem(viewer, ctx, item, { version, ...changes }, req) {
  assertTasksWritable(ctx.project);
  const res = await db.taskChecklistItem.updateMany({ where: { id: item.id, version }, data: { ...changes, version: { increment: 1 }, updated_by: viewer.id } });
  if (res.count !== 1) throw staleUpdate();
  if ('is_done' in changes && changes.is_done !== item.is_done) {
    await writeAudit({ req, action: 'task.checklist_checked', entityType: 'Task', entityId: ctx.task.id, projectId: ctx.project.id, clientId: ctx.project.client_id, before: { is_done: item.is_done }, after: { text: item.text, is_done: changes.is_done } });
  }
  return itemDto(await db.taskChecklistItem.findUniqueOrThrow({ where: { id: item.id } }));
}

export async function deleteChecklistItem(_viewer, ctx, item, req) {
  assertTasksWritable(ctx.project);
  await db.taskChecklistItem.delete({ where: { id: item.id } });
  await writeAudit({ req, action: 'task.checklist_removed', entityType: 'Task', entityId: ctx.task.id, projectId: ctx.project.id, clientId: ctx.project.client_id, before: { text: item.text } });
}

// ---------------------------------------------------------------------------
// Dependencies (FR-TSK-07): finish-to-start, same project, no cycles
// ---------------------------------------------------------------------------

/** True when `from` can already reach `to` through successor links (adding to→from would close a loop). */
async function reaches(fromId, toId) {
  const seen = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length) {
    const next = await db.taskDependency.findMany({ where: { predecessor_id: { in: frontier } }, select: { successor_id: true } });
    frontier = [];
    for (const { successor_id: id } of next) {
      if (id === toId) return true;
      if (!seen.has(id)) {
        seen.add(id);
        frontier.push(id);
      }
    }
  }
  return false;
}

export async function addDependency(viewer, ctx, { predecessor_id: predecessorId }, req) {
  assertTasksWritable(ctx.project);
  const { task } = ctx;
  if (predecessorId === task.id) throw fieldError('predecessor_id', 'A task cannot depend on itself');
  const pred = await db.task.findFirst({ where: { id: predecessorId, deleted_at: null }, select: { id: true, project_id: true, title: true } });
  if (!pred || pred.project_id !== task.project_id) throw fieldError('predecessor_id', 'Choose a task of the same project'); // D-28
  // Adding pred → task closes a loop if task already leads to pred (TC-TSK-004)
  if (await reaches(task.id, pred.id)) {
    throw new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'This dependency would create a loop', [{ field: 'predecessor_id', message: 'Creates a cycle' }]);
  }
  const existing = await db.taskDependency.findUnique({ where: { predecessor_id_successor_id: { predecessor_id: pred.id, successor_id: task.id } } });
  if (!existing) {
    await db.taskDependency.create({
      data: { workspace_id: task.workspace_id, predecessor_id: pred.id, successor_id: task.id, created_by: viewer.id, updated_by: viewer.id },
    });
    await writeAudit({ req, action: 'task.dependency_added', entityType: 'Task', entityId: task.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { predecessor_id: pred.id } });
  }
  return { predecessor: pred, created: !existing };
}

export async function removeDependency(_viewer, ctx, predecessorId, req) {
  assertTasksWritable(ctx.project);
  if (!isUuid(predecessorId)) throw notFound('Dependency not found');
  const res = await db.taskDependency.deleteMany({ where: { predecessor_id: predecessorId, successor_id: ctx.task.id } });
  if (res.count === 0) throw notFound('Dependency not found');
  await writeAudit({ req, action: 'task.dependency_removed', entityType: 'Task', entityId: ctx.task.id, projectId: ctx.project.id, clientId: ctx.project.client_id, before: { predecessor_id: predecessorId } });
}

// ---------------------------------------------------------------------------
// Bulk actions (FR-TSK-11): every task checked on its own; partial failures reported
// ---------------------------------------------------------------------------

const BULK_PERMISSION = { status: 'task.editWork', assign: 'task.update', unassign: 'task.update', due_date: 'task.editDetails', delete: 'task.delete' };

export async function bulkTasks(viewer, body, req) {
  const results = [];
  for (const taskId of body.task_ids) {
    try {
      const ctx = await loadTaskContext(req, taskId);
      if (!can(viewer, BULK_PERMISSION[body.action], ctx) || !can(viewer, 'task.read', ctx)) {
        throw new AppError(403, ERROR_CODES.FORBIDDEN, 'You are not allowed to change this task');
      }
      const { task } = ctx;
      if (body.action === 'status') {
        await service.changeTaskStatus(viewer, ctx, { status: body.status, version: task.version }, req);
      } else if (body.action === 'assign' || body.action === 'unassign') {
        const current = task.assignees.map((a) => a.user_id);
        const next = body.action === 'assign' ? [...new Set([...current, body.user_id])] : current.filter((id) => id !== body.user_id);
        if (next.length === current.length && next.every((id) => current.includes(id))) {
          results.push({ id: taskId, ok: true, unchanged: true });
          continue;
        }
        await service.updateTask(viewer, ctx, { version: task.version, assignee_ids: next }, req);
      } else if (body.action === 'due_date') {
        await service.updateTask(viewer, ctx, { version: task.version, due_date: body.due_date }, req);
      } else if (body.action === 'delete') {
        await service.deleteTask(viewer, ctx, req);
      }
      results.push({ id: taskId, ok: true });
    } catch (err) {
      if (!err?.status) throw err; // unexpected errors still fail the whole request
      results.push({ id: taskId, ok: false, code: err.code, message: err.message });
    }
  }
  return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

