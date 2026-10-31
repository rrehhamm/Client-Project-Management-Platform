// Tasks: FR-TSK-01…07/09/10/12…14, BR-TSK-01…06, D-23, D-24, D-27, FR-PRJ-07.
import { ERROR_CODES, TASK_STATUS, USER_STATUS, taskTransition } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { projectScope } from '../../auth/scopes.js';
import { assignmentChangeProblem } from '../../auth/taskAssignment.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { fromDbDate, toDbDate, workspaceWeek } from '../../lib/dates.js';
import { AppError, conflict, fieldError, forbidden, staleUpdate, transitionNotAllowed } from '../../lib/errors.js';
import { cleanRichText } from '../../lib/richText.js';
import { membershipOf, projectInclude, recalculateProgress, todayForWorkspace } from '../projects/common.js';
import { POSITION_GAP, assertTasksWritable, bottomPosition, taskCounts, taskInclude, toTaskDto } from './common.js';
import { followNewTask, taskAssigned, taskStatusChanged } from './notifications.js';

const CLOSED = [TASK_STATUS.DONE, TASK_STATUS.CANCELLED];
const OPEN = { notIn: CLOSED };
const LEAVING_TODO_BLOCKED = [TASK_STATUS.IN_PROGRESS, TASK_STATUS.IN_REVIEW, TASK_STATUS.DONE];
const AUDITED = ['title', 'status', 'priority', 'start_date', 'due_date', 'estimate_minutes', 'visibility', 'milestone_id', 'is_billable', 'labels'];

const auditView = (t, keys) => {
  const v = pick(t, keys);
  for (const k of ['start_date', 'due_date']) if (k in v) v[k] = fromDbDate(v[k]);
  return v;
};

async function reloadTask(id, client = db) {
  return client.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
}

/** FR-TSK-03: only active project members can be assigned. */
async function assertAssignable(projectId, userIds, client = db) {
  if (!userIds.length) return;
  const members = await client.projectMember.findMany({
    where: { project_id: projectId, user_id: { in: userIds } },
    include: { user: { select: { status: true } } },
  });
  const ok = new Set(members.filter((m) => m.user.status === USER_STATUS.ACTIVE).map((m) => m.user_id));
  const bad = userIds.filter((id) => !ok.has(id));
  if (bad.length) {
    throw new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'Only active members of this project can be assigned', [
      { field: 'assignee_ids', message: 'Not an active project member' },
    ]);
  }
}

async function assertMilestone(projectId, milestoneId, client = db) {
  if (!milestoneId) return;
  const m = await client.milestone.findFirst({ where: { id: milestoneId, project_id: projectId, deleted_at: null }, select: { id: true } });
  if (!m) throw fieldError('milestone_id', 'Choose a milestone of this project');
}

async function setAssignees(tx, task, ids, viewer, project) {
  const current = await tx.taskAssignee.findMany({ where: { task_id: task.id } });
  const before = new Set(current.map((a) => a.user_id));
  const after = new Set(ids);
  const removed = current.filter((a) => !after.has(a.user_id)).map((a) => a.id);
  if (removed.length) await tx.taskAssignee.deleteMany({ where: { id: { in: removed } } });
  const added = ids.filter((id) => !before.has(id));
  if (added.length) {
    await tx.taskAssignee.createMany({
      data: added.map((user_id) => ({ workspace_id: task.workspace_id, task_id: task.id, user_id, created_by: viewer.id, updated_by: viewer.id })),
    });
  }
  await taskAssigned(tx, { task, project, userIds: added, viewer }); // FR-NOT-02, FR-NOT-05
  return { before: [...before].sort(), after: [...after].sort(), changed: added.length + removed.length > 0 };
}

async function detailDto(viewer, taskId, ctx) {
  const task = await reloadTask(taskId);
  const today = await todayForWorkspace(viewer.workspace_id);
  const counts = (await taskCounts([task.id])).get(task.id);
  return toTaskDto(task, viewer, { today, counts, ctx });
}

// ---------------------------------------------------------------------------
// List / read (FR-TSK-09)
// ---------------------------------------------------------------------------

export async function listTasks(viewer, ctx, q) {
  const today = await todayForWorkspace(viewer.workspace_id);
  const and = [{ project_id: ctx.project.id, deleted_at: null }];
  // Contacts see Client-visible tasks only (BR-CLI-01, FR-PORT-02)
  if (viewer.kind === 'contact') and.push({ visibility: 'Client' });
  if (q.parent_task_id) and.push({ parent_task_id: q.parent_task_id });
  else if (!q.all_levels) and.push({ parent_task_id: null });
  if (q.status) and.push({ status: q.status });
  if (q.assignee === 'me') and.push({ assignees: { some: { user_id: viewer.id } } });
  else if (q.assignee === 'none') and.push({ assignees: { none: {} } });
  else if (q.assignee) and.push({ assignees: { some: { user_id: q.assignee } } });
  if (q.milestone === 'none') and.push({ milestone_id: null });
  else if (q.milestone) and.push({ milestone_id: q.milestone });
  if (q.label) and.push({ labels: { has: q.label } });
  if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } });
  if (q.due_from) and.push({ due_date: { gte: toDbDate(q.due_from) } });
  if (q.due_to) and.push({ due_date: { lte: toDbDate(q.due_to) } });
  if (q.overdue) and.push({ due_date: { lt: toDbDate(today) }, status: OPEN });

  const where = { AND: and };
  const [rows, total] = await Promise.all([
    db.task.findMany({ where, include: taskInclude, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.task.count({ where }),
  ]);
  const counts = await taskCounts(rows.map((t) => t.id));
  return { data: rows.map((t) => toTaskDto(t, viewer, { today, counts: counts.get(t.id) })), page: q.page, page_size: q.page_size, total };
}

export async function getTaskDetail(viewer, ctx) {
  const dto = await detailDto(viewer, ctx.task.id, ctx);
  const subtasks = await db.task.findMany({
    where: { parent_task_id: ctx.task.id, deleted_at: null, ...(viewer.kind === 'contact' ? { visibility: 'Client' } : {}) },
    include: taskInclude,
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  const today = await todayForWorkspace(viewer.workspace_id);
  dto.subtasks = subtasks.map((s) => toTaskDto(s, viewer, { today }));
  if (viewer.kind === 'contact') return dto; // BR-TSK-06: no checklist, dependencies or internals

  const [checklist, preds, succs] = await Promise.all([
    db.taskChecklistItem.findMany({ where: { task_id: ctx.task.id }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    db.taskDependency.findMany({ where: { successor_id: ctx.task.id, predecessor: { deleted_at: null } }, include: { predecessor: { select: { id: true, title: true, status: true } } } }),
    db.taskDependency.findMany({ where: { predecessor_id: ctx.task.id, successor: { deleted_at: null } }, include: { successor: { select: { id: true, title: true, status: true } } } }),
  ]);
  dto.checklist = checklist.map((i) => ({ id: i.id, text: i.text, is_done: i.is_done, sort_order: i.sort_order, version: i.version }));
  dto.predecessors = preds.map((d) => d.predecessor);
  dto.successors = succs.map((d) => d.successor);
  return dto;
}

// ---------------------------------------------------------------------------
// Create (FR-TSK-01, FR-TSK-04)
// ---------------------------------------------------------------------------

export async function createTask(viewer, ctx, body, req) {
  const { project } = ctx;
  assertTasksWritable(project);
  // D-24 also applies when creating: Team Members cannot set these
  const denied = [
    ['visibility', 'task.changeVisibility'],
    ['milestone_id', 'task.changeMilestone'],
    ['is_billable', 'task.changeBillable'],
  ].filter(([field, action]) => body[field] !== undefined && body[field] !== null && !can(viewer, action, ctx));
  if (denied.length) {
    const err = forbidden('You are not allowed to set some of these fields');
    err.fields = denied.map(([field]) => ({ field, message: 'Not allowed for your role' }));
    throw err;
  }
  const assignees = body.assignee_ids ?? [];
  if (assignees.some((id) => id !== viewer.id) && !can(viewer, 'task.assignOthers', ctx)) {
    throw forbidden("Only the project's PM, an Admin or the Owner can assign other people");
  }

  let parent = null;
  if (body.parent_task_id) {
    parent = await db.task.findFirst({ where: { id: body.parent_task_id, project_id: project.id, deleted_at: null } });
    if (!parent) throw fieldError('parent_task_id', 'Choose a task of this project');
    if (parent.parent_task_id) throw fieldError('parent_task_id', 'Subtasks cannot have subtasks'); // FR-TSK-04, TC-TSK-005
  }
  await assertMilestone(project.id, body.milestone_id);
  await assertAssignable(project.id, assignees);

  const created = await db.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: project.id,
        parent_task_id: parent?.id ?? null,
        // Subtasks inherit visibility (and the milestone, unless one is given) at creation
        milestone_id: body.milestone_id !== undefined ? body.milestone_id : (parent?.milestone_id ?? null),
        visibility: parent ? parent.visibility : (body.visibility ?? 'Internal'),
        title: body.title,
        description: cleanRichText(body.description ?? null),
        priority: body.priority ?? 'Normal',
        start_date: toDbDate(body.start_date ?? null),
        due_date: toDbDate(body.due_date ?? null),
        estimate_minutes: body.estimate_minutes ?? null,
        is_billable: body.is_billable ?? null,
        labels: body.labels ?? [],
        sort_order: await bottomPosition(project.id, parent?.id, tx),
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    await followNewTask(tx, t, viewer); // FR-NOT-05: the creator follows
    if (assignees.length) await setAssignees(tx, t, assignees, viewer, project);
    if (!parent) await recalculateProgress(project.id, tx); // FR-PRJ-07
    await writeAudit(
      { req, action: 'task.created', entityType: 'Task', entityId: t.id, projectId: project.id, clientId: project.client_id, after: { ...auditView(t, AUDITED), parent_task_id: t.parent_task_id, assignee_ids: assignees } },
      tx,
    );
    return t;
  });
  return detailDto(viewer, created.id, ctx);
}

// ---------------------------------------------------------------------------
// Update (FR-TSK-02/03/14, BR-TSK-01/05, D-24)
// ---------------------------------------------------------------------------

export async function updateTask(viewer, ctx, { version, apply_to_subtasks: applyToSubtasks, assignee_ids: assigneeIds, ...changes }, req) {
  const { project, task } = ctx;
  if (Object.keys(changes).length === 0 && assigneeIds === undefined) throw fieldError(null, 'Nothing to update');
  assertTasksWritable(project);
  const start = changes.start_date === undefined ? fromDbDate(task.start_date) : changes.start_date;
  const due = changes.due_date === undefined ? fromDbDate(task.due_date) : changes.due_date;
  if (start && due && due < start) throw fieldError('due_date', 'Due date cannot be before start date'); // BR-TSK-01
  if (changes.milestone_id !== undefined) await assertMilestone(project.id, changes.milestone_id);
  if (assigneeIds !== undefined) {
    const problem = assignmentChangeProblem(viewer, ctx, task.assignees, assigneeIds); // D-24
    if (problem) {
      const err = forbidden(problem);
      err.fields = [{ field: 'assignee_ids', message: problem }];
      throw err;
    }
    const newOnes = assigneeIds.filter((id) => !task.assignees.some((a) => a.user_id === id));
    await assertAssignable(project.id, newOnes);
  }

  const data = { ...changes, version: { increment: 1 }, updated_by: viewer.id };
  if (changes.description !== undefined) data.description = cleanRichText(changes.description);
  if (changes.start_date !== undefined) data.start_date = toDbDate(changes.start_date);
  if (changes.due_date !== undefined) data.due_date = toDbDate(changes.due_date);

  await db.$transaction(async (tx) => {
    const res = await tx.task.updateMany({ where: { id: task.id, version, deleted_at: null }, data });
    if (res.count !== 1) throw staleUpdate(); // NFR-CONC-01, TC-NFR-001
    // FR-TSK-14: subtasks follow a visibility change only when asked to
    if (changes.visibility !== undefined && applyToSubtasks) {
      await tx.task.updateMany({ where: { parent_task_id: task.id, deleted_at: null }, data: { visibility: changes.visibility, updated_by: viewer.id } });
    }
    const assignment = assigneeIds !== undefined ? await setAssignees(tx, task, assigneeIds, viewer, project) : null;
    const after = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    const changed = AUDITED.filter((k) => k in changes && JSON.stringify(auditView(task, [k])[k]) !== JSON.stringify(auditView(after, [k])[k]));
    if (changed.length || assignment?.changed) {
      await writeAudit(
        {
          req,
          action: assignment?.changed && !changed.length ? 'task.assignees_changed' : 'task.updated',
          entityType: 'Task',
          entityId: task.id,
          projectId: project.id,
          clientId: project.client_id,
          before: { ...auditView(task, changed), ...(assignment?.changed ? { assignee_ids: assignment.before } : {}) },
          after: { ...auditView(after, changed), ...(assignment?.changed ? { assignee_ids: assignment.after } : {}) },
        },
        tx,
      );
    }
  });
  return detailDto(viewer, task.id, ctx);
}

// ---------------------------------------------------------------------------
// Status (FR-TSK-06/07, BR-TSK-02, D-23)
// ---------------------------------------------------------------------------

export async function changeTaskStatus(viewer, ctx, { status, version, complete_subtasks: completeSubtasks }, req) {
  const { project, task } = ctx;
  assertTasksWritable(project);
  const kind = taskTransition(task.status, status);
  if (!kind) throw transitionNotAllowed();
  if (kind === 'reopen' && !can(viewer, 'task.reopen', ctx)) {
    throw forbidden('Only the project manager, an Admin or the Owner can reopen a task');
  }

  // FR-TSK-07: a successor cannot start (or finish) while a predecessor is not Done
  if (task.status === TASK_STATUS.TO_DO && LEAVING_TODO_BLOCKED.includes(status)) {
    const blockers = await db.taskDependency.findMany({
      where: { successor_id: task.id, predecessor: { deleted_at: null, status: { not: TASK_STATUS.DONE } } },
      include: { predecessor: { select: { title: true } } },
    });
    if (blockers.length) {
      throw new AppError(409, ERROR_CODES.CONFLICT, `Blocked by: ${blockers.map((b) => b.predecessor.title).join(', ')}`, blockers.map((b) => ({ field: 'predecessors', message: b.predecessor.title })));
    }
  }

  let openSubtasks = [];
  if (status === TASK_STATUS.DONE) {
    openSubtasks = await db.task.findMany({ where: { parent_task_id: task.id, deleted_at: null, status: OPEN }, select: { id: true, title: true } });
    if (openSubtasks.length && !completeSubtasks) {
      throw new AppError(409, ERROR_CODES.CONFLICT, 'Close the open subtasks first, or complete them all', openSubtasks.map((s) => ({ field: 'subtasks', message: s.title }))); // BR-TSK-02, TC-TSK-002
    }
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    const res = await tx.task.updateMany({
      where: { id: task.id, version, status: task.status, deleted_at: null },
      data: { status, completed_at: status === TASK_STATUS.DONE ? now : null, version: { increment: 1 }, updated_by: viewer.id },
    });
    if (res.count !== 1) throw staleUpdate();
    if (openSubtasks.length) {
      await tx.task.updateMany({
        where: { id: { in: openSubtasks.map((s) => s.id) } },
        data: { status: TASK_STATUS.DONE, completed_at: now, version: { increment: 1 }, updated_by: viewer.id },
      });
    }
    if (!task.parent_task_id) await recalculateProgress(project.id, tx); // FR-PRJ-07
    await writeAudit(
      {
        req,
        action: kind === 'reopen' ? 'task.reopened' : 'task.status_changed',
        entityType: 'Task',
        entityId: task.id,
        projectId: project.id,
        clientId: project.client_id,
        before: { status: task.status },
        after: { status, ...(openSubtasks.length ? { completed_subtasks: openSubtasks.length } : {}) },
      },
      tx,
    );
    await taskStatusChanged(tx, { task, project, from: task.status, to: status, viewer });
  });
  return detailDto(viewer, task.id, ctx);
}

// ---------------------------------------------------------------------------
// Position (FR-TSK-12)
// ---------------------------------------------------------------------------

export async function setTaskPosition(viewer, ctx, { after_id: afterId }, req) {
  const { project, task } = ctx;
  assertTasksWritable(project);
  const siblings = { project_id: project.id, parent_task_id: task.parent_task_id, deleted_at: null, id: { not: task.id } };
  let prev = null;
  if (afterId) {
    prev = await db.task.findFirst({ where: { ...siblings, id: afterId }, select: { id: true, sort_order: true } });
    if (!prev) throw fieldError('after_id', 'Choose a task from the same list');
  }
  const next = await db.task.findFirst({
    where: { ...siblings, ...(prev ? { sort_order: { gt: prev.sort_order } } : {}) },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: { sort_order: true },
  });
  const low = prev?.sort_order ?? (next ? next.sort_order - 2 * POSITION_GAP : 0);
  const high = next?.sort_order ?? low + 2 * POSITION_GAP;

  await db.$transaction(async (tx) => {
    if (high - low >= 2) {
      await tx.task.update({ where: { id: task.id }, data: { sort_order: Math.floor((low + high) / 2), updated_by: viewer.id } });
    } else {
      // No gap left: renumber the whole sibling list with fresh gaps.
      const ordered = await tx.task.findMany({ where: siblings, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], select: { id: true } });
      const ids = ordered.map((t) => t.id);
      const at = prev ? ids.indexOf(prev.id) + 1 : 0;
      ids.splice(at, 0, task.id);
      for (const [i, id] of ids.entries()) await tx.task.update({ where: { id }, data: { sort_order: (i + 1) * POSITION_GAP } });
    }
    await writeAudit({ req, action: 'task.reordered', entityType: 'Task', entityId: task.id, projectId: project.id, clientId: project.client_id, after: { after_id: afterId } }, tx);
  });
  return detailDto(viewer, task.id, ctx);
}

// ---------------------------------------------------------------------------
// Move to another project (BR-TSK-04, D-27)
// ---------------------------------------------------------------------------

export async function moveTask(viewer, ctx, { project_id: targetId }, req) {
  const { project, task } = ctx;
  assertTasksWritable(project);
  if (task.parent_task_id) throw fieldError('project_id', 'Move the parent task instead; subtasks move with it');
  if (targetId === project.id) throw fieldError('project_id', 'The task is already in this project');
  const target = await db.project.findFirst({ where: { id: targetId, workspace_id: project.workspace_id, deleted_at: null }, include: projectInclude });
  if (!target) throw fieldError('project_id', 'Project not found');
  const targetCtx = { project: target, membership: await membershipOf(viewer, target.id) };
  if (!can(viewer, 'task.create', targetCtx)) throw forbidden('You cannot add tasks to that project');
  if (target.client_id !== project.client_id) throw conflict('Tasks can only move between projects of the same client');
  assertTasksWritable(target);

  const subtasks = await db.task.findMany({ where: { parent_task_id: task.id, deleted_at: null }, select: { id: true } });
  const ids = [task.id, ...subtasks.map((s) => s.id)];
  if ((await db.timeEntry.count({ where: { task_id: { in: ids } } })) > 0) {
    throw conflict('Tasks with time entries cannot move to another project');
  }
  const targetMembers = new Set(
    (await db.projectMember.findMany({ where: { project_id: target.id, user_id: { not: null } }, select: { user_id: true } })).map((m) => m.user_id),
  );
  const assignees = await db.taskAssignee.findMany({ where: { task_id: { in: ids } }, include: { user: { select: { id: true, full_name: true } } } });
  const dropped = assignees.filter((a) => !targetMembers.has(a.user_id));

  await db.$transaction(async (tx) => {
    await tx.taskDependency.deleteMany({ where: { OR: [{ predecessor_id: { in: ids } }, { successor_id: { in: ids } }] } });
    if (dropped.length) await tx.taskAssignee.deleteMany({ where: { id: { in: dropped.map((a) => a.id) } } });
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { project_id: target.id, milestone_id: null, updated_by: viewer.id } });
    await tx.task.update({ where: { id: task.id }, data: { sort_order: await bottomPosition(target.id, null, tx), version: { increment: 1 } } });
    await recalculateProgress(project.id, tx);
    await recalculateProgress(target.id, tx);
    await writeAudit(
      {
        req,
        action: 'task.moved',
        entityType: 'Task',
        entityId: task.id,
        projectId: target.id,
        clientId: project.client_id,
        before: { project_id: project.id, milestone_id: task.milestone_id },
        after: { project_id: target.id, removed_assignee_ids: [...new Set(dropped.map((a) => a.user_id))] },
      },
      tx,
    );
  });
  const removed = [...new Map(dropped.map((a) => [a.user.id, { id: a.user.id, full_name: a.user.full_name }])).values()];
  return { task: await detailDto(viewer, task.id, targetCtx), removed_assignees: removed };
}

// ---------------------------------------------------------------------------
// Delete (FR-TSK-13)
// ---------------------------------------------------------------------------

export async function deleteTask(viewer, ctx, req) {
  const { project, task } = ctx;
  assertTasksWritable(project);
  const subtasks = await db.task.findMany({ where: { parent_task_id: task.id, deleted_at: null }, select: { id: true } });
  const ids = [task.id, ...subtasks.map((s) => s.id)];
  if ((await db.timeEntry.count({ where: { task_id: { in: ids }, status: 'Invoiced' } })) > 0) {
    throw conflict('This task has invoiced time and cannot be deleted');
  }
  await db.$transaction(async (tx) => {
    await tx.taskDependency.deleteMany({ where: { OR: [{ predecessor_id: { in: ids } }, { successor_id: { in: ids } }] } });
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { deleted_at: new Date(), updated_by: viewer.id } });
    if (!task.parent_task_id) await recalculateProgress(project.id, tx);
    await writeAudit(
      { req, action: 'task.deleted', entityType: 'Task', entityId: task.id, projectId: project.id, clientId: project.client_id, before: { title: task.title, status: task.status }, after: { deleted_subtasks: subtasks.length } },
      tx,
    );
  });
  return { deleted_subtasks: subtasks.length };
}

// ---------------------------------------------------------------------------
// Labels in use (for suggestions)
// ---------------------------------------------------------------------------

export async function labelsInUse(project) {
  const rows = await db.$queryRaw`
    SELECT DISTINCT unnest(labels) AS label FROM tasks
    WHERE project_id = ${project.id}::uuid AND deleted_at IS NULL
    ORDER BY 1 LIMIT 200`;
  return { data: rows.map((r) => r.label) };
}

// ---------------------------------------------------------------------------
// My Tasks (FR-TSK-10, BR-DASH-02)
// ---------------------------------------------------------------------------

const GROUP_LIMIT = 100;

export async function myTasks(viewer) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id }, select: { timezone: true, week_start_day: true } });
  const { today, weekEnd } = workspaceWeek(ws); // BR-DASH-02

  const tasks = await db.task.findMany({
    where: {
      workspace_id: viewer.workspace_id,
      deleted_at: null,
      status: OPEN,
      assignees: { some: { user_id: viewer.id } },
      project: { deleted_at: null, archived_at: null },
    },
    include: { ...taskInclude, project: { select: { id: true, code: true, name: true } } },
    orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { sort_order: 'asc' }],
    take: 1000,
  });
  const groups = { overdue: [], today: [], this_week: [], later: [] };
  for (const t of tasks) {
    const due = fromDbDate(t.due_date);
    const key = !due ? 'later' : due < today ? 'overdue' : due === today ? 'today' : due <= weekEnd ? 'this_week' : 'later';
    groups[key].push(t);
  }
  const out = { as_of: today, week_end: weekEnd }; // "today" is also a group name
  for (const [key, list] of Object.entries(groups)) {
    out[key] = {
      total: list.length,
      data: list.slice(0, GROUP_LIMIT).map((t) => ({ ...toTaskDto(t, viewer, { today }), project: t.project })),
    };
  }
  return out;
}


// ---------------------------------------------------------------------------
// Cross-project task list (FR-DASH-05 drill-down). Dashboard cards count with this
// same filter, so a card's number always equals the list total (TC-DASH-001).
// ---------------------------------------------------------------------------

export function workTaskWhere(viewer, q, week) {
  const and = [
    { workspace_id: viewer.workspace_id, deleted_at: null },
    { project: { deleted_at: null, archived_at: null, ...projectScope(viewer) } }, // BR-DASH-01
  ];
  if (q.mine) and.push({ project: { pm_user_id: viewer.id } });
  if (q.open || q.due || q.inactive_assignee) and.push({ status: OPEN });
  if (q.status) and.push({ status: q.status });
  if (q.due === 'this_week') and.push({ due_date: { gte: toDbDate(week.weekStart), lte: toDbDate(week.weekEnd) } }); // BR-DASH-02
  if (q.due === 'overdue') and.push({ due_date: { lt: toDbDate(week.today) } });
  if (q.inactive_assignee) and.push({ assignees: { some: { user: { status: { not: USER_STATUS.ACTIVE } } } } }); // FR-USER-05
  return { AND: and };
}

export async function listWorkTasks(viewer, q) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id }, select: { timezone: true, week_start_day: true } });
  const week = workspaceWeek(ws);
  const where = workTaskWhere(viewer, q, week);
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      include: { ...taskInclude, project: { select: { id: true, code: true, name: true } }, parent: { select: { id: true, title: true } } },
      orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.page_size,
      take: q.page_size,
    }),
    db.task.count({ where }),
  ]);
  return {
    data: rows.map((t) => ({ ...toTaskDto(t, viewer, { today: week.today }), project: t.project, parent: t.parent })),
    page: q.page,
    page_size: q.page_size,
    total,
    week: { start: week.weekStart, end: week.weekEnd },
  };
}
