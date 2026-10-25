// Shared pieces of the tasks module: loading a task for authorize(), the public
// task shape (BR-TSK-06 for contacts), ordering and the "can this task change" rule.
import { TASK_EDITABLE_PROJECT_STATUSES, TASK_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { db } from '../../lib/db.js';
import { fromDbDate } from '../../lib/dates.js';
import { conflict, notFound } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { membershipOf, projectInclude } from '../projects/common.js';

export const POSITION_GAP = 1024; // FR-TSK-12: gaps so a move updates one row
const CLOSED = [TASK_STATUS.DONE, TASK_STATUS.CANCELLED];

export const taskInclude = {
  assignees: { include: { user: { select: { id: true, full_name: true, status: true } } }, orderBy: { created_at: 'asc' } },
  milestone: { select: { id: true, title: true, deleted_at: true } },
  _count: { select: { subtasks: { where: { deleted_at: null } }, checklist_items: true } },
};

/** ctx.record for can(): the task plus assignee ids. */
export const recordOf = (task) => ({ ...task, assignee_ids: (task.assignees ?? []).map((a) => a.user_id) });

/** authorize() loader for /tasks/:id routes. */
export async function loadTaskContext(req, taskId = req.params.taskId) {
  const task = isUuid(taskId)
    ? await db.task.findFirst({ where: { id: taskId, workspace_id: req.principal.workspace_id, deleted_at: null }, include: taskInclude })
    : null;
  if (!task) throw notFound('Task not found');
  const project = await db.project.findFirst({ where: { id: task.project_id, deleted_at: null }, include: projectInclude });
  if (!project) throw notFound('Task not found');
  const membership = await membershipOf(req.principal, project.id);
  return { project, membership, task, record: recordOf(task) };
}

/** Tasks change only while the project is open and not archived (FR-PRJ-10, BRD 16.1). */
export function assertTasksWritable(project) {
  if (project.archived_at) throw conflict('This project is archived and read-only. Unarchive it first.');
  if (!TASK_EDITABLE_PROJECT_STATUSES.includes(project.status)) {
    throw conflict(`Tasks of a ${project.status === 'Completed' ? 'completed' : 'cancelled'} project cannot change. Reopen the project first.`);
  }
}

export const isTaskOverdue = (task, today) => {
  const due = fromDbDate(task.due_date);
  return Boolean(due) && due < today && !CLOSED.includes(task.status); // BR-TSK-03
};

/** Open/closed counts of subtasks and checklist done count, for many tasks at once. */
export async function taskCounts(taskIds) {
  if (!taskIds.length) return new Map();
  const [subs, checks] = await Promise.all([
    db.task.groupBy({ by: ['parent_task_id', 'status'], where: { parent_task_id: { in: taskIds }, deleted_at: null }, _count: { _all: true } }),
    db.taskChecklistItem.groupBy({ by: ['task_id', 'is_done'], where: { task_id: { in: taskIds } }, _count: { _all: true } }),
  ]);
  const out = new Map(taskIds.map((id) => [id, { subtasks: 0, open_subtasks: 0, checklist_total: 0, checklist_done: 0 }]));
  for (const r of subs) {
    const c = out.get(r.parent_task_id);
    c.subtasks += r._count._all;
    if (!CLOSED.includes(r.status)) c.open_subtasks += r._count._all;
  }
  for (const r of checks) {
    const c = out.get(r.task_id);
    c.checklist_total += r._count._all;
    if (r.is_done) c.checklist_done += r._count._all;
  }
  return out;
}

/**
 * Public task shape. Contacts get only what BR-TSK-06 allows (title, status, due
 * date, milestone) plus assignee names (OD-06). Never estimates or billable flags.
 */
export function toTaskDto(task, viewer, { today, counts, ctx } = {}) {
  const milestone = task.milestone && !task.milestone.deleted_at ? { id: task.milestone.id, title: task.milestone.title } : null;
  const assignees = (task.assignees ?? []).map((a) => ({
    id: a.user.id,
    full_name: a.user.full_name,
    status: a.user.status,
    self_assigned: a.created_by === a.user_id,
  }));
  if (viewer.kind === 'contact') {
    return {
      id: task.id,
      project_id: task.project_id,
      parent_task_id: task.parent_task_id,
      title: task.title,
      status: task.status,
      due_date: fromDbDate(task.due_date),
      milestone,
      assignees: assignees.map((a) => ({ full_name: a.full_name })),
    };
  }
  const c = counts ?? { subtasks: task._count?.subtasks ?? 0, open_subtasks: null, checklist_total: task._count?.checklist_items ?? 0, checklist_done: null };
  const dto = {
    id: task.id,
    project_id: task.project_id,
    parent_task_id: task.parent_task_id,
    milestone,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    start_date: fromDbDate(task.start_date),
    due_date: fromDbDate(task.due_date),
    estimate_minutes: task.estimate_minutes,
    visibility: task.visibility,
    is_billable: task.is_billable,
    labels: task.labels,
    sort_order: task.sort_order,
    assignees,
    // FR-USER-05: open tasks of deactivated users are flagged "Assignee inactive"
    has_inactive_assignee: !CLOSED.includes(task.status) && assignees.some((a) => a.status !== 'Active'),
    is_overdue: today ? isTaskOverdue(task, today) : false,
    is_client_request: task.is_client_request,
    subtask_count: c.subtasks,
    open_subtask_count: c.open_subtasks,
    checklist_total: c.checklist_total,
    checklist_done: c.checklist_done,
    completed_at: task.completed_at,
    created_by: task.created_by,
    created_at: task.created_at,
    updated_at: task.updated_at,
    version: task.version,
  };
  if (ctx) {
    const full = { ...ctx, record: recordOf(task) };
    dto.permissions = {
      edit_work: can(viewer, 'task.editWork', full),
      edit_details: can(viewer, 'task.editDetails', full),
      change_visibility: can(viewer, 'task.changeVisibility', full),
      change_milestone: can(viewer, 'task.changeMilestone', full),
      change_billable: can(viewer, 'task.changeBillable', full),
      assign_others: can(viewer, 'task.assignOthers', full),
      assign_self: can(viewer, 'task.assignSelf', full),
      reopen: can(viewer, 'task.reopen', full),
      delete: can(viewer, 'task.delete', full),
      move: can(viewer, 'task.move', full),
      manage_dependencies: can(viewer, 'task.manageDependencies', full),
    };
  }
  return dto;
}

/** Next sort_order at the bottom of a sibling group (FR-TSK-01). */
export async function bottomPosition(projectId, parentId, client = db) {
  const last = await client.task.aggregate({ where: { project_id: projectId, parent_task_id: parentId ?? null, deleted_at: null }, _max: { sort_order: true } });
  return (last._max.sort_order ?? 0) + POSITION_GAP;
}
