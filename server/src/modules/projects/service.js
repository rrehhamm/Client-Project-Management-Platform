// Projects: FR-PRJ-01, 04, 06…11, BR-PRJ-01…05/07, lifecycle (BRD 16.1), D-02, D-12, D-19.
import {
  ARCHIVABLE_STATUSES,
  CLIENT_STATUS,
  ERROR_CODES,
  MILESTONE_STATUS,
  PROJECT_ROLE,
  PROJECT_STATUS,
  PROJECT_TRANSITIONS,
  ROLES,
  TASK_STATUS,
  USER_STATUS,
} from '@cpm/shared';
import { can } from '../../auth/can.js';
import { projectScope } from '../../auth/scopes.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { AppError, conflict, fieldError, staleUpdate, transitionNotAllowed } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { applyStructure, snapshotProject, structureFromTemplate } from '../templates/structure.js';
import { assertTemplateUsable } from '../templates/service.js';
import { activeProjectWhere, assertWritable, membershipOf, projectInclude, recalculateProgress, toProjectDto, todayForWorkspace } from './common.js';

const RESTORE_DAYS = 30; // FR-PRJ-11
const PM_ROLES = [ROLES.PM, ROLES.ADMIN, ROLES.OWNER]; // D-19
const OPEN_TASK_STATUSES = { notIn: [TASK_STATUS.DONE, TASK_STATUS.CANCELLED] };
const AUDITED = ['name', 'status', 'start_date', 'due_date', 'billing_type', 'budget_amount', 'budget_minutes', 'pm_user_id', 'client_id', 'portal_enabled'];

const normalizeName = (name) => name.trim().toLowerCase();
const duplicateName = () =>
  conflict('A project with this name already exists for this client', [{ field: 'name', message: 'Already used for this client' }]); // BR-PRJ-01

/** Audit-friendly copy with date-only fields as strings. */
const auditView = (p, keys) => {
  const v = pick(p, keys);
  for (const k of ['start_date', 'due_date']) if (k in v) v[k] = fromDbDate(v[k]);
  return v;
};

// ---------------------------------------------------------------------------
// List / detail (FR-PRJ-08, FR-PRJ-09)
// ---------------------------------------------------------------------------

export async function listProjects(viewer, q) {
  const today = await todayForWorkspace(viewer.workspace_id);
  const where = projectListWhere(viewer, q, today);
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      include: projectInclude,
      // Only due_date is nullable; projects without one sort last
      orderBy: [q.sort === 'due_date' ? { due_date: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order }, { id: 'asc' }],
      skip: (q.page - 1) * q.page_size,
      take: q.page_size,
    }),
    db.project.count({ where }),
  ]);
  return { data: rows.map((p) => toProjectDto(p, viewer, { today })), page: q.page, page_size: q.page_size, total };
}

/** The project list filter. Dashboard cards count with this same filter (FR-DASH-05, TC-DASH-001). */
export function projectListWhere(viewer, q, today) {
  const and = [{ workspace_id: viewer.workspace_id }, projectScope(viewer)];
  and.push(q.deleted ? { deleted_at: { not: null } } : { deleted_at: null });
  if (q.archived === 'exclude') and.push({ archived_at: null });
  if (q.archived === 'only') and.push({ archived_at: { not: null } });
  if (q.client_id) and.push({ client_id: q.client_id });
  if (q.status) and.push({ status: q.status });
  if (q.pm_user_id) and.push({ pm_user_id: q.pm_user_id });
  if (q.member_id) and.push({ members: { some: { user_id: q.member_id } } });
  if (q.due_from) and.push({ due_date: { gte: toDbDate(q.due_from) } });
  if (q.due_to) and.push({ due_date: { lte: toDbDate(q.due_to) } });
  if (q.active === true) and.push(activeProjectWhere()); // D-36
  if (q.overdue === true) {
    and.push({ due_date: { lt: toDbDate(today) }, status: { notIn: [PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED] } });
  }
  if (q.q) and.push({ OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q.toUpperCase() } }] });
  return { AND: and };
}

export async function getProjectDetail(viewer, project) {
  const today = await todayForWorkspace(viewer.workspace_id);
  const membership = await membershipOf(viewer, project.id);
  const [taskCounts, milestoneCounts, memberCount] = await Promise.all([
    db.task.groupBy({ by: ['status'], where: { project_id: project.id, deleted_at: null }, _count: { _all: true } }),
    db.milestone.groupBy({ by: ['status'], where: { project_id: project.id, deleted_at: null }, _count: { _all: true } }),
    db.projectMember.count({ where: { project_id: project.id } }),
  ]);
  const ctx = { project, membership };
  return toProjectDto(project, viewer, {
    today,
    extras: {
      task_summary: Object.fromEntries(Object.values(TASK_STATUS).map((s) => [s, taskCounts.find((t) => t.status === s)?._count._all ?? 0])),
      milestone_summary: Object.fromEntries(
        Object.values(MILESTONE_STATUS)
          .filter((s) => s !== MILESTONE_STATUS.OVERDUE) // D-20: computed, never stored
          .map((s) => [s, milestoneCounts.find((m) => m.status === s)?._count._all ?? 0]),
      ),
      member_count: memberCount,
      // Budget used arrives with time tracking (Phase 6, FR-PRJ-13)
      allowed_transitions: PROJECT_TRANSITIONS[project.status],
      permissions: {
        update: can(viewer, 'project.update', ctx),
        delete: can(viewer, 'project.delete', ctx),
        manage_members: can(viewer, 'projectMember.manage', ctx),
        manage_milestones: can(viewer, 'milestone.update', ctx),
        create_task: can(viewer, 'task.create', ctx),
        manage_tasks: can(viewer, 'task.assignOthers', ctx), // PM/Admin/Owner: reorder, bulk, assign anyone
        assign_self: can(viewer, 'task.assignSelf', ctx),
        save_template: can(viewer, 'template.save', ctx),
        duplicate: can(viewer, 'project.duplicate', ctx),
        upload_file: can(viewer, 'file.create', ctx), // FR-FILE-01
        manage_files: can(viewer, 'file.update', ctx), // folders, sharing (FR-FILE-05/07)
        comment: can(viewer, 'comment.create', ctx),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Create (FR-PRJ-01)
// ---------------------------------------------------------------------------

/** D-19: the PM must be an active PM, Admin or Owner of this workspace. */
async function assertEligiblePm(workspaceId, userId, client = db) {
  const pm = await client.user.findFirst({ where: { id: userId, workspace_id: workspaceId }, select: { status: true, role: true } });
  if (!pm || pm.status !== USER_STATUS.ACTIVE || !PM_ROLES.includes(pm.role)) {
    throw fieldError('pm_user_id', 'Choose an active Project Manager, Admin or Owner');
  }
}

async function assertNameFree(clientId, name, exceptId, client = db) {
  const existing = await client.project.findFirst({
    where: { client_id: clientId, name_normalized: normalizeName(name), deleted_at: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw duplicateName();
}

async function activeClient(workspaceId, clientId, client = db) {
  const c = await client.client.findFirst({ where: { id: clientId, workspace_id: workspaceId } });
  if (!c) throw fieldError('client_id', 'Client not found');
  // FR-PRJ-01 / BR-PRJ-05 / D-22: manual projects need an Active client
  if (c.status !== CLIENT_STATUS.ACTIVE) {
    throw conflict('Projects can only be created for active clients', [{ field: 'client_id', message: `Client is ${c.status}` }]);
  }
  return c;
}

/**
 * @param {object} [options]
 * @param {object} [options.structure]  milestones/tasks/members to copy in (FR-PRJ-12)
 * @param {string} [options.duplicatedFromId]
 */
export async function createProject(viewer, body, req, { structure: givenStructure = null, duplicatedFromId = null } = {}) {
  await assertEligiblePm(viewer.workspace_id, body.pm_user_id);
  if (body.template_id) await assertTemplateUsable(viewer.workspace_id, body.template_id); // FR-PRJ-02
  const created = await db.$transaction(async (tx) => {
    const client = await activeClient(viewer.workspace_id, body.client_id, tx);
    await assertNameFree(client.id, body.name, null, tx);
    // Taking the next number with an UPDATE locks the client row, so concurrent
    // creates get distinct codes (FR-PRJ-01). The first project locks the prefix (D-02).
    const counter = await tx.client.update({
      where: { id: client.id },
      data: { next_project_number: { increment: 1 }, code_prefix_locked_at: client.code_prefix_locked_at ?? new Date() },
      select: { next_project_number: true, code_prefix: true },
    });
    const number = counter.next_project_number - 1;
    const project = await tx.project.create({
      data: {
        workspace_id: viewer.workspace_id,
        client_id: client.id,
        name: body.name,
        name_normalized: normalizeName(body.name),
        description: body.description ?? null,
        code: `${counter.code_prefix}-${String(number).padStart(3, '0')}`,
        status: PROJECT_STATUS.NOT_STARTED,
        start_date: toDbDate(body.start_date),
        due_date: toDbDate(body.due_date ?? null),
        billing_type: body.billing_type,
        budget_amount: body.budget_amount ?? null,
        budget_minutes: body.budget_minutes ?? null,
        pm_user_id: body.pm_user_id,
        portal_enabled: body.portal_enabled ?? false,
        close_task_on_approval: body.close_task_on_approval ?? false,
        source_template_id: body.template_id ?? null,
        duplicated_from_id: duplicatedFromId,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
      include: projectInclude,
    });
    // The PM and the creator become members (FR-PRJ-01)
    await tx.projectMember.create({
      data: { workspace_id: viewer.workspace_id, project_id: project.id, user_id: body.pm_user_id, project_role: PROJECT_ROLE.PM, created_by: viewer.id, updated_by: viewer.id },
    });
    if (viewer.kind === 'user' && viewer.id !== body.pm_user_id) {
      await tx.projectMember.create({
        data: { workspace_id: viewer.workspace_id, project_id: project.id, user_id: viewer.id, project_role: PROJECT_ROLE.MEMBER, created_by: viewer.id, updated_by: viewer.id },
      });
    }
    // FR-PRJ-02 / FR-PRJ-12: copy milestones, tasks, checklists, dependencies, default members (D-26)
    const structure = body.template_id ? await structureFromTemplate(tx, body.template_id) : givenStructure;
    const copied = structure ? await applyStructure(tx, structure, project, viewer) : null;
    await writeAudit(
      {
        req,
        action: duplicatedFromId ? 'project.duplicated' : 'project.created',
        entityType: 'Project',
        entityId: project.id,
        projectId: project.id,
        clientId: client.id,
        after: { code: project.code, ...auditView(project, AUDITED), template_id: body.template_id ?? null, duplicated_from_id: duplicatedFromId, copied },
      },
      tx,
    );
    return tx.project.findUniqueOrThrow({ where: { id: project.id }, include: projectInclude });
  });
  return toProjectDto(created, viewer, { today: await todayForWorkspace(viewer.workspace_id) });
}

// ---------------------------------------------------------------------------
// Update (FR-PRJ-04), incl. PM change (FR-PRJ-05)
// ---------------------------------------------------------------------------

export async function updateProject(viewer, project, { version, ...changes }, req) {
  assertWritable(project);
  const startDate = changes.start_date ?? fromDbDate(project.start_date);
  const dueDate = changes.due_date === undefined ? fromDbDate(project.due_date) : changes.due_date;
  if (dueDate && dueDate < startDate) throw fieldError('due_date', 'Due date cannot be before start date'); // BR-PRJ-02

  const clientChanges = changes.client_id !== undefined && changes.client_id !== project.client_id;
  if (clientChanges) {
    const [time, invoices] = await Promise.all([
      db.timeEntry.count({ where: { project_id: project.id } }),
      db.invoice.count({ where: { project_id: project.id } }),
    ]);
    if (time + invoices > 0) {
      throw conflict('The client cannot change once the project has time entries or invoices', [{ field: 'client_id', message: 'Locked' }]);
    }
    await activeClient(viewer.workspace_id, changes.client_id);
  }
  const targetClient = changes.client_id ?? project.client_id;
  if (clientChanges || (changes.name !== undefined && normalizeName(changes.name) !== project.name_normalized)) {
    await assertNameFree(targetClient, changes.name ?? project.name, project.id);
  }
  const pmChanges = changes.pm_user_id !== undefined && changes.pm_user_id !== project.pm_user_id;
  if (pmChanges) await assertEligiblePm(viewer.workspace_id, changes.pm_user_id);

  const data = { ...changes, version: { increment: 1 }, updated_by: viewer.id };
  if (changes.name !== undefined) data.name_normalized = normalizeName(changes.name);
  if (changes.start_date !== undefined) data.start_date = toDbDate(changes.start_date);
  if (changes.due_date !== undefined) data.due_date = toDbDate(changes.due_date);

  const after = await db.$transaction(async (tx) => {
    const res = await tx.project.updateMany({ where: { id: project.id, version, deleted_at: null }, data });
    if (res.count !== 1) throw staleUpdate();
    if (pmChanges) {
      // The old PM stays a member; the new PM is a member with the PM role.
      await tx.projectMember.updateMany({ where: { project_id: project.id, user_id: project.pm_user_id }, data: { project_role: PROJECT_ROLE.MEMBER, updated_by: viewer.id } });
      await tx.projectMember.upsert({
        where: { project_id_user_id: { project_id: project.id, user_id: changes.pm_user_id } },
        update: { project_role: PROJECT_ROLE.PM, updated_by: viewer.id },
        create: { workspace_id: project.workspace_id, project_id: project.id, user_id: changes.pm_user_id, project_role: PROJECT_ROLE.PM, created_by: viewer.id, updated_by: viewer.id },
      });
    }
    const updated = await tx.project.findUniqueOrThrow({ where: { id: project.id }, include: projectInclude });
    const changed = AUDITED.filter((k) => k in changes && String(auditView(project, [k])[k]) !== String(auditView(updated, [k])[k]));
    if (changed.length) {
      await writeAudit(
        {
          req,
          action: changed.includes('pm_user_id') ? 'project.pm_changed' : 'project.updated',
          entityType: 'Project',
          entityId: project.id,
          projectId: project.id,
          clientId: updated.client_id,
          before: auditView(project, changed),
          after: auditView(updated, changed),
        },
        tx,
      );
    }
    return updated;
  });
  return getProjectDetail(viewer, after);
}

// ---------------------------------------------------------------------------
// Status (FR-PRJ-06, BRD 16.1, BR-PRJ-03, BR-PRJ-05)
// ---------------------------------------------------------------------------

export async function changeStatus(viewer, project, { status, version }, req) {
  assertWritable(project);
  if (status === project.status) throw transitionNotAllowed(`The project is already ${status}`);
  if (!PROJECT_TRANSITIONS[project.status].includes(status)) throw transitionNotAllowed();

  if (status === PROJECT_STATUS.COMPLETED) {
    const [openMilestones, openTasks] = await Promise.all([
      db.milestone.findMany({ where: { project_id: project.id, deleted_at: null, status: { not: MILESTONE_STATUS.COMPLETED } }, select: { title: true }, take: 20 }),
      db.task.findMany({ where: { project_id: project.id, deleted_at: null, status: OPEN_TASK_STATUSES }, select: { title: true }, take: 20 }),
    ]);
    if (openMilestones.length || openTasks.length) {
      throw new AppError(409, ERROR_CODES.CONFLICT, 'Complete all milestones and close all tasks first', [
        ...openMilestones.map((m) => ({ field: 'milestones', message: m.title })),
        ...openTasks.map((t) => ({ field: 'tasks', message: t.title })),
      ]); // BR-PRJ-03, TC-PRJ-005
    }
  }
  const reopening = project.status === PROJECT_STATUS.COMPLETED && status === PROJECT_STATUS.IN_PROGRESS;
  if (reopening && project.client.status === CLIENT_STATUS.ARCHIVED) {
    throw conflict('Projects of an archived client cannot be reopened. Restore the client first.'); // BR-PRJ-05
  }

  const after = await db.$transaction(async (tx) => {
    const res = await tx.project.updateMany({
      where: { id: project.id, version, status: project.status },
      data: {
        status,
        completed_at: status === PROJECT_STATUS.COMPLETED ? new Date() : null,
        ...(status === PROJECT_STATUS.COMPLETED ? { progress_pct: 100 } : {}), // BR-PRJ-03
        version: { increment: 1 },
        updated_by: viewer.id,
      },
    });
    if (res.count !== 1) throw staleUpdate();
    if (reopening) await recalculateProgress(project.id, tx);
    await writeAudit(
      {
        req,
        action: reopening ? 'project.reopened' : 'project.status_changed',
        entityType: 'Project',
        entityId: project.id,
        projectId: project.id,
        clientId: project.client_id,
        before: { status: project.status },
        after: { status },
      },
      tx,
    );
    // FR-PRJ-06: internal members hear about the change (contacts: portal, Phase 5)
    const members = await tx.projectMember.findMany({ where: { project_id: project.id, user_id: { not: null } }, select: { user_id: true } });
    const label = { NotStarted: 'Not started', InProgress: 'In progress', OnHold: 'On hold', Completed: 'Completed', Cancelled: 'Cancelled' }[status] ?? status;
    await notify(tx, {
      workspaceId: project.workspace_id,
      event: 'project_status',
      actorId: viewer.id,
      userIds: members.map((m) => m.user_id),
      internal: true,
      entityType: 'Project',
      entityId: project.id,
      payload: {
        title: `${viewer.full_name} changed ${project.code} to ${label}`,
        subject: `${project.code} · ${project.name}: ${label}`,
        text: `${viewer.full_name} changed the status of ${project.code} · ${project.name} to ${label}.`,
        link: `/projects/${project.id}`,
        actor_name: viewer.full_name,
        project_code: project.code,
      },
    });
    return tx.project.findUniqueOrThrow({ where: { id: project.id }, include: projectInclude });
  });
  return getProjectDetail(viewer, after);
}

// ---------------------------------------------------------------------------
// Archive (FR-PRJ-10), delete and restore (FR-PRJ-11)
// ---------------------------------------------------------------------------

export async function archiveProject(viewer, project, req) {
  if (project.archived_at) throw conflict('This project is already archived');
  if (!ARCHIVABLE_STATUSES.includes(project.status)) throw conflict('Only completed or cancelled projects can be archived');
  const after = await db.project.update({
    where: { id: project.id },
    data: { archived_at: new Date(), archived_by: viewer.id, version: { increment: 1 }, updated_by: viewer.id },
    include: projectInclude,
  });
  await writeAudit({ req, action: 'project.archived', entityType: 'Project', entityId: project.id, projectId: project.id, clientId: project.client_id });
  return getProjectDetail(viewer, after);
}

export async function unarchiveProject(viewer, project, req) {
  if (!project.archived_at) throw conflict('This project is not archived');
  const after = await db.project.update({
    where: { id: project.id },
    data: { archived_at: null, archived_by: null, version: { increment: 1 }, updated_by: viewer.id },
    include: projectInclude,
  });
  await writeAudit({ req, action: 'project.unarchived', entityType: 'Project', entityId: project.id, projectId: project.id, clientId: project.client_id });
  return getProjectDetail(viewer, after);
}

export async function deleteProject(viewer, project, { confirm_name: confirmName }, req) {
  if (confirmName.trim() !== project.name) throw fieldError('confirm_name', 'Type the project name exactly to confirm');
  const [time, invoices] = await Promise.all([
    db.timeEntry.count({ where: { project_id: project.id } }),
    db.invoice.count({ where: { project_id: project.id } }),
  ]);
  if (time + invoices > 0) {
    throw conflict('This project has time entries or invoices and cannot be deleted. Archive it instead.'); // TC-PRJ-006
  }
  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: { deleted_at: new Date(), deleted_by: viewer.id, updated_by: viewer.id } });
    await writeAudit({ req, action: 'project.deleted', entityType: 'Project', entityId: project.id, projectId: project.id, clientId: project.client_id, before: { name: project.name, code: project.code } }, tx);
  });
}

export async function restoreProject(viewer, project, req) {
  if (!project.deleted_at) throw conflict('This project is not deleted');
  if (Date.now() - project.deleted_at.getTime() > RESTORE_DAYS * 24 * 60 * 60 * 1000) {
    throw conflict(`Deleted projects can be restored for ${RESTORE_DAYS} days only`);
  }
  await assertNameFree(project.client_id, project.name, project.id);
  const after = await db.project.update({
    where: { id: project.id },
    data: { deleted_at: null, deleted_by: null, version: { increment: 1 }, updated_by: viewer.id },
    include: projectInclude,
  });
  await writeAudit({ req, action: 'project.restored', entityType: 'Project', entityId: project.id, projectId: project.id, clientId: project.client_id });
  return getProjectDetail(viewer, after);
}

// ---------------------------------------------------------------------------
// Duplicate (FR-PRJ-12, D-26): same copy as a template, new name required
// ---------------------------------------------------------------------------

export async function duplicateProject(viewer, project, { name, start_date: startDate }, req) {
  const start = startDate ?? fromDbDate(project.start_date);
  const shift = Date.parse(`${start}T00:00:00Z`) - project.start_date.getTime();
  const due = project.due_date ? new Date(project.due_date.getTime() + shift).toISOString().slice(0, 10) : null;
  const structure = await snapshotProject(db, project);
  return createProject(
    viewer,
    {
      client_id: project.client_id,
      name,
      description: project.description,
      start_date: start,
      due_date: due,
      billing_type: project.billing_type,
      pm_user_id: project.pm_user_id,
      budget_amount: project.budget_amount,
      budget_minutes: project.budget_minutes,
      portal_enabled: project.portal_enabled,
      close_task_on_approval: project.close_task_on_approval,
    },
    req,
    { structure, duplicatedFromId: project.id },
  );
}
