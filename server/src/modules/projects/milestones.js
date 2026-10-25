// Milestones: FR-MS-01…03 (+ amount for FR-MS-04 / BR-PRJ-06), D-20.
import { BILLING_TYPE, ERROR_CODES, MILESTONE_STATUS, TASK_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { AppError, conflict, fieldError, notFound, staleUpdate, transitionNotAllowed, validationError } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { assertWritable, membershipOf, projectInclude, todayForWorkspace } from './common.js';

const OPEN_TASKS = { notIn: [TASK_STATUS.DONE, TASK_STATUS.CANCELLED] };
const AUDITED = ['title', 'due_date', 'status', 'amount', 'visibility'];

const auditView = (m, keys) => {
  const v = pick(m, keys);
  if ('due_date' in v) v.due_date = fromDbDate(v.due_date);
  return v;
};

export function toMilestoneDto(m, viewer, ctx, { today, counts } = {}) {
  const due = fromDbDate(m.due_date);
  const dto = {
    id: m.id,
    project_id: m.project_id,
    title: m.title,
    description: m.description,
    due_date: due,
    status: m.status,
    // D-20: computed on read in the workspace timezone, never stored
    is_overdue: Boolean(today) && due < today && m.status !== MILESTONE_STATUS.COMPLETED,
    visibility: m.visibility,
    sort_order: m.sort_order,
    completed_at: m.completed_at,
    task_count: counts?.total ?? 0,
    open_task_count: counts?.open ?? 0,
    created_at: m.created_at,
    updated_at: m.updated_at,
    version: m.version,
  };
  if (can(viewer, 'project.viewFinancials', ctx)) dto.amount = m.amount;
  return dto;
}

async function taskCountsFor(milestoneIds) {
  if (!milestoneIds.length) return new Map();
  const rows = await db.task.groupBy({
    by: ['milestone_id', 'status'],
    where: { milestone_id: { in: milestoneIds }, deleted_at: null },
    _count: { _all: true },
  });
  const out = new Map();
  for (const r of rows) {
    const c = out.get(r.milestone_id) ?? { total: 0, open: 0 };
    c.total += r._count._all;
    if (![TASK_STATUS.DONE, TASK_STATUS.CANCELLED].includes(r.status)) c.open += r._count._all;
    out.set(r.milestone_id, c);
  }
  return out;
}

/** authorize() loader for /milestones/:id routes. */
export async function loadMilestoneContext(req) {
  const milestone = isUuid(req.params.milestoneId)
    ? await db.milestone.findFirst({ where: { id: req.params.milestoneId, workspace_id: req.principal.workspace_id, deleted_at: null } })
    : null;
  if (!milestone) throw notFound('Milestone not found');
  const project = await db.project.findFirst({ where: { id: milestone.project_id, deleted_at: null }, include: projectInclude });
  if (!project) throw notFound('Milestone not found');
  const membership = await membershipOf(req.principal, project.id);
  return { project, membership, milestone, record: milestone };
}

export async function listMilestones(viewer, ctx) {
  const rows = await db.milestone.findMany({
    where: { project_id: ctx.project.id, deleted_at: null },
    orderBy: [{ sort_order: 'asc' }, { due_date: 'asc' }, { id: 'asc' }],
  });
  // Contacts see Client-visible milestones only (FR-PORT-02); the rule is checked per row.
  const visible = rows.filter((m) => can(viewer, 'milestone.read', { ...ctx, record: m }));
  const [today, counts] = await Promise.all([todayForWorkspace(viewer.workspace_id), taskCountsFor(visible.map((m) => m.id))]);
  return { data: visible.map((m) => toMilestoneDto(m, viewer, ctx, { today, counts: counts.get(m.id) })) };
}

/** FR-MS-01: due date outside the project's dates is a warning, not an error. */
function dateWarnings(project, dueIso) {
  const start = fromDbDate(project.start_date);
  const end = fromDbDate(project.due_date);
  if ((start && dueIso < start) || (end && dueIso > end)) return ["The milestone's due date is outside the project's dates"];
  return [];
}

/** BR-PRJ-06: milestone amounts above the Fixed budget need explicit confirmation. */
async function checkBudget(project, { amount, excludeId, confirmed }) {
  if (amount === undefined) return;
  if (amount !== null && project.billing_type !== BILLING_TYPE.FIXED) {
    throw fieldError('amount', 'Milestone amounts are only for Fixed-price projects'); // FR-MS-04
  }
  if (amount === null || project.budget_amount === null || confirmed) return;
  const others = await db.milestone.aggregate({
    where: { project_id: project.id, deleted_at: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { amount: true },
  });
  const total = (others._sum.amount ?? 0n) + BigInt(amount);
  if (total > project.budget_amount) {
    throw new AppError(
      409,
      ERROR_CODES.CONFIRMATION_REQUIRED,
      'Milestone amounts would exceed the project budget. Confirm to save anyway.',
      [{ field: 'amount', message: `Total ${total} exceeds budget ${project.budget_amount}` }],
    );
  }
}

export async function createMilestone(viewer, ctx, body, req) {
  const { project } = ctx;
  assertWritable(project);
  await checkBudget(project, { amount: body.amount, confirmed: body.confirm_over_budget === true });
  const last = await db.milestone.aggregate({ where: { project_id: project.id, deleted_at: null }, _max: { sort_order: true } });
  const created = await db.$transaction(async (tx) => {
    const m = await tx.milestone.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: project.id,
        title: body.title,
        description: body.description ?? null,
        due_date: toDbDate(body.due_date),
        amount: body.amount ?? null,
        visibility: body.visibility ?? 'Internal',
        sort_order: (last._max.sort_order ?? -1) + 1,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    await writeAudit({ req, action: 'milestone.created', entityType: 'Milestone', entityId: m.id, projectId: project.id, clientId: project.client_id, after: auditView(m, AUDITED) }, tx);
    return m;
  });
  const today = await todayForWorkspace(viewer.workspace_id);
  return { milestone: toMilestoneDto(created, viewer, ctx, { today }), warnings: dateWarnings(project, body.due_date) };
}

export async function updateMilestone(viewer, ctx, { version, confirm_over_budget: confirmed, ...changes }, req) {
  const { project, milestone } = ctx;
  assertWritable(project);
  if (changes.status !== undefined && changes.status !== milestone.status) {
    // Upcoming ↔ In Progress; Completed → In Progress reopens (FR-MS-02). Completing uses /complete.
    const reopening = milestone.status === MILESTONE_STATUS.COMPLETED && changes.status === MILESTONE_STATUS.IN_PROGRESS;
    if (milestone.status === MILESTONE_STATUS.COMPLETED && !reopening) throw transitionNotAllowed();
  }
  await checkBudget(project, { amount: changes.amount, excludeId: milestone.id, confirmed: confirmed === true });

  const data = { ...changes, version: { increment: 1 }, updated_by: viewer.id };
  if (changes.due_date !== undefined) data.due_date = toDbDate(changes.due_date);
  if (changes.status !== undefined && changes.status !== MILESTONE_STATUS.COMPLETED) data.completed_at = null;

  const after = await db.$transaction(async (tx) => {
    const res = await tx.milestone.updateMany({ where: { id: milestone.id, version, deleted_at: null }, data });
    if (res.count !== 1) throw staleUpdate();
    const m = await tx.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
    const changed = AUDITED.filter((k) => k in changes && String(auditView(milestone, [k])[k]) !== String(auditView(m, [k])[k]));
    if (changed.length) {
      await writeAudit(
        { req, action: 'milestone.updated', entityType: 'Milestone', entityId: m.id, projectId: project.id, clientId: project.client_id, before: auditView(milestone, changed), after: auditView(m, changed) },
        tx,
      );
    }
    return m;
  });
  const today = await todayForWorkspace(viewer.workspace_id);
  const counts = (await taskCountsFor([after.id])).get(after.id);
  return {
    milestone: toMilestoneDto(after, viewer, ctx, { today, counts }),
    warnings: changes.due_date ? dateWarnings(project, changes.due_date) : [],
  };
}

/** FR-MS-03: only when every task of the milestone is Done or Cancelled. */
export async function completeMilestone(viewer, ctx, req) {
  const { project, milestone } = ctx;
  assertWritable(project);
  if (milestone.status === MILESTONE_STATUS.COMPLETED) throw conflict('This milestone is already completed');
  const open = await db.task.findMany({ where: { milestone_id: milestone.id, deleted_at: null, status: OPEN_TASKS }, select: { title: true }, take: 50 });
  if (open.length) {
    throw new AppError(409, ERROR_CODES.CONFLICT, 'Close these tasks before completing the milestone', open.map((t) => ({ field: 'tasks', message: t.title }))); // TC-MS-001
  }
  const after = await db.$transaction(async (tx) => {
    const m = await tx.milestone.update({
      where: { id: milestone.id },
      data: { status: MILESTONE_STATUS.COMPLETED, completed_at: new Date(), version: { increment: 1 }, updated_by: viewer.id },
    });
    await writeAudit(
      { req, action: 'milestone.completed', entityType: 'Milestone', entityId: m.id, projectId: project.id, clientId: project.client_id, before: { status: milestone.status }, after: { status: m.status } },
      tx,
    );
    return m;
  });
  // FR-MS-04 "Create invoice" offer comes with invoicing (Phase 7).
  const today = await todayForWorkspace(viewer.workspace_id);
  return { milestone: toMilestoneDto(after, viewer, ctx, { today }), warnings: [] };
}

/** BRD 5.2: deleting a milestone clears it from its tasks. */
export async function deleteMilestone(viewer, ctx, req) {
  const { project, milestone } = ctx;
  assertWritable(project);
  await db.$transaction(async (tx) => {
    await tx.task.updateMany({ where: { milestone_id: milestone.id }, data: { milestone_id: null } });
    await tx.milestone.update({ where: { id: milestone.id }, data: { deleted_at: new Date(), updated_by: viewer.id } });
    await writeAudit(
      { req, action: 'milestone.deleted', entityType: 'Milestone', entityId: milestone.id, projectId: project.id, clientId: project.client_id, before: auditView(milestone, AUDITED) },
      tx,
    );
  });
}

/** Reorder: `ids` must list every current milestone of the project exactly once. */
export async function reorderMilestones(viewer, ctx, { ids }, req) {
  const { project } = ctx;
  assertWritable(project);
  const current = await db.milestone.findMany({ where: { project_id: project.id, deleted_at: null }, select: { id: true } });
  const known = new Set(current.map((m) => m.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw validationError([{ field: 'ids', message: 'List every milestone of this project exactly once' }]);
  }
  await db.$transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.milestone.update({ where: { id }, data: { sort_order: i, updated_by: viewer.id } });
    await writeAudit({ req, action: 'milestone.reordered', entityType: 'Project', entityId: project.id, projectId: project.id, clientId: project.client_id, after: { ids } }, tx);
  });
  return listMilestones(viewer, ctx);
}
