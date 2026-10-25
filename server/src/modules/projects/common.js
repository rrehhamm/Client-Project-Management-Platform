// Shared pieces of the projects module: loading a project for authorize(),
// the archived read-only rule, progress, and the public project shape.
import { PROJECT_STATUS, TASK_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { db } from '../../lib/db.js';
import { fromDbDate, workspaceToday } from '../../lib/dates.js';
import { conflict, notFound } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';

export const projectInclude = {
  client: { select: { id: true, name: true, status: true, currency: true } },
  pm_user: { select: { id: true, full_name: true, status: true } },
};

/** The principal's membership row on a project (null if none). */
export function membershipOf(principal, projectId, client = db) {
  return client.projectMember.findFirst({
    where: { project_id: projectId, ...(principal.kind === 'user' ? { user_id: principal.id } : { contact_id: principal.id }) },
  });
}

/** authorize() loader for /projects/:id routes. Soft-deleted projects are 404 unless asked for. */
export async function loadProjectContext(req, projectId, { includeDeleted = false } = {}) {
  const project = isUuid(projectId)
    ? await db.project.findFirst({
        where: { id: projectId, workspace_id: req.principal.workspace_id, ...(includeDeleted ? {} : { deleted_at: null }) },
        include: projectInclude,
      })
    : null;
  if (!project) throw notFound('Project not found');
  const membership = await membershipOf(req.principal, project.id);
  return { project, membership, record: project };
}

/** FR-PRJ-10: archived projects are read-only. */
export function assertWritable(project) {
  if (project.archived_at) throw conflict('This project is archived and read-only. Unarchive it first.');
}

/**
 * FR-PRJ-07: completed ÷ total top-level tasks (Cancelled excluded) × 100, rounded
 * down; no tasks → 0. Called after task status changes (Phase 3) and on reopen.
 */
export async function recalculateProgress(projectId, client = db) {
  const tasks = await client.task.groupBy({
    by: ['status'],
    where: { project_id: projectId, parent_task_id: null, deleted_at: null, status: { not: TASK_STATUS.CANCELLED } },
    _count: { _all: true },
  });
  const total = tasks.reduce((n, t) => n + t._count._all, 0);
  const done = tasks.find((t) => t.status === TASK_STATUS.DONE)?._count._all ?? 0;
  const pct = total === 0 ? 0 : Math.floor((done / total) * 100);
  await client.project.update({ where: { id: projectId }, data: { progress_pct: pct } });
  return pct;
}

const CLOSED = [PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED];

/** BR-PRJ-04: overdue is a flag — today (workspace TZ) after due date and not closed. */
export function isProjectOverdue(project, today) {
  const due = fromDbDate(project.due_date);
  return Boolean(due) && today > due && !CLOSED.includes(project.status);
}

export function toProjectDto(p, viewer, { today, extras = {} } = {}) {
  const dto = {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    client: p.client ? { id: p.client.id, name: p.client.name } : { id: p.client_id },
    status: p.status,
    start_date: fromDbDate(p.start_date),
    due_date: fromDbDate(p.due_date),
    billing_type: p.billing_type,
    progress_pct: p.progress_pct,
    pm: p.pm_user ? { id: p.pm_user.id, full_name: p.pm_user.full_name, status: p.pm_user.status } : { id: p.pm_user_id },
    portal_enabled: p.portal_enabled,
    close_task_on_approval: p.close_task_on_approval,
    is_overdue: today ? isProjectOverdue(p, today) : false,
    completed_at: p.completed_at,
    archived_at: p.archived_at,
    deleted_at: p.deleted_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    version: p.version,
    ...extras,
  };
  if (can(viewer, 'project.viewFinancials')) {
    dto.budget_amount = p.budget_amount;
    dto.budget_minutes = p.budget_minutes;
    dto.currency = p.client?.currency ?? null;
  }
  return dto;
}

export async function todayForWorkspace(workspaceId) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
  return workspaceToday(ws);
}
