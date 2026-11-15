// Approvals: FR-APP-01…07, BR-APP-01…03, TC-APP-001…003.
// A request asks one or more Approve-level contacts to approve a Client-visible file
// version or task. Internal users request, pin and cancel; only the named contacts
// decide (BR-APP-02). A decided request never changes again (BR-APP-01).
import { APPROVAL_STATUS, PREVIEWABLE_TYPES, TASK_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { projectScope } from '../../auth/scopes.js';
import { writeAudit } from '../../lib/audit.js';
import { addDays, fromDbDate, toDbDate, workspaceToday } from '../../lib/dates.js';
import { db } from '../../lib/db.js';
import { AppError, conflict, fieldError, forbidden, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { getFileUrl } from '../../lib/storage.js';
import { isUuid } from '../../lib/validate.js';
import { membershipOf, projectInclude, recalculateProgress } from '../projects/common.js';
import { taskStatusChanged } from '../tasks/notifications.js';

const PENDING = APPROVAL_STATUS.PENDING;

export const approvalInclude = {
  project: { select: { id: true, code: true, name: true, client_id: true, pm_user_id: true, workspace_id: true, close_task_on_approval: true, portal_enabled: true } },
  file_version: { select: { id: true, version_no: true, mime_type: true, original_name: true, storage_key: true, scan_status: true, file: { select: { id: true, name: true, task_id: true, visibility: true, deleted_at: true } } } },
  task: { select: { id: true, title: true, status: true, visibility: true, deleted_at: true } },
  requester: { select: { id: true, full_name: true } },
  approvers: { include: { contact: { select: { id: true, full_name: true } } }, orderBy: { created_at: 'asc' } },
  pins: { include: { author_user: { select: { id: true, full_name: true } }, author_contact: { select: { id: true, full_name: true } } }, orderBy: { number: 'asc' } },
};

const subjectOf = (a) =>
  a.file_version
    ? { type: 'file', file: { id: a.file_version.file.id, name: a.file_version.file.name }, version_no: a.file_version.version_no, mime_type: a.file_version.mime_type, proofable: PREVIEWABLE_TYPES.includes(a.file_version.mime_type) }
    : { type: 'task', task: { id: a.task.id, title: a.task.title, status: a.task.status } };

const pinDto = (p) => ({ id: p.id, number: p.number, page: p.page, x: p.x, y: p.y, body: p.body, author: p.author_user ? { kind: 'user', full_name: p.author_user.full_name } : { kind: 'contact', full_name: p.author_contact?.full_name ?? null }, created_at: p.created_at });

/** Internal shape (FR-APP-05: every decision with name, time, note; IP for the audit trail). */
export function toApprovalDto(a, viewer, ctx) {
  const dto = {
    id: a.id,
    project: { id: a.project.id, code: a.project.code, name: a.project.name },
    subject: subjectOf(a),
    status: a.status,
    rule: a.rule,
    due_date: fromDbDate(a.due_date),
    message: a.message,
    requested_by: a.requester ? { id: a.requester.id, full_name: a.requester.full_name } : null,
    approvers: a.approvers.map((x) => ({ contact_id: x.contact_id, full_name: x.contact.full_name, decision: x.decision, decision_note: x.decision_note, decided_at: x.decided_at, decision_ip: x.decision_ip })),
    pins: a.pins.map(pinDto),
    decision_note: a.decision_note,
    decided_at: a.decision_at,
    cancelled_at: a.cancelled_at,
    created_at: a.created_at,
  };
  if (ctx) {
    const full = { ...ctx, record: a };
    dto.permissions = { cancel: a.status === PENDING && can(viewer, 'approval.cancel', full), pin: a.status === PENDING && Boolean(a.file_version) && can(viewer, 'approval.pin', full) };
  }
  return dto;
}

/** Portal shape: no IPs, no internal ids beyond what the contact needs (D-40). */
export function toPortalApprovalDto(a, contact) {
  const mine = a.approvers.find((x) => x.contact_id === contact.id);
  return {
    id: a.id,
    project: { id: a.project.id, code: a.project.code, name: a.project.name },
    subject: subjectOf(a),
    status: a.status,
    rule: a.rule,
    due_date: fromDbDate(a.due_date),
    message: a.message,
    requested_by: a.requester ? { full_name: a.requester.full_name } : null,
    approvers: a.approvers.map((x) => ({ full_name: x.contact.full_name, decision: x.decision, decision_note: x.decision_note, decided_at: x.decided_at, is_me: x.contact_id === contact.id })),
    pins: a.pins.map(pinDto),
    created_at: a.created_at,
    decided_at: a.decision_at,
    my_decision: mine?.decision ?? null,
    can_decide: a.status === PENDING && Boolean(mine) && !mine.decision,
  };
}

// ---------------------------------------------------------------------------
// Loading and listing
// ---------------------------------------------------------------------------

/** authorize() loader for /approvals/:approvalId (internal). */
export async function loadApprovalContext(req, id = req.params.approvalId) {
  const a = isUuid(id) ? await db.approvalRequest.findFirst({ where: { id, workspace_id: req.principal.workspace_id, project: { deleted_at: null } }, include: approvalInclude }) : null;
  if (!a) throw notFound('Approval not found');
  const project = await db.project.findUniqueOrThrow({ where: { id: a.project_id }, include: projectInclude });
  const membership = await membershipOf(req.principal, project.id);
  return { project, membership, approval: a, record: { ...a, created_by: a.requested_by } };
}

/** The list filter; dashboard cards count with this same filter (FR-DASH-05). */
export function approvalListWhere(viewer, q) {
  return {
    AND: [
      { workspace_id: viewer.workspace_id, project: { deleted_at: null, ...projectScope(viewer) } },
      q.status ? { status: q.status } : {},
      q.project_id ? { project_id: q.project_id } : {},
      q.mine ? { project: { pm_user_id: viewer.id } } : {},
      q.file_id ? { file_version: { file_id: q.file_id } } : {},
    ],
  };
}

export async function listApprovals(viewer, q) {
  const where = approvalListWhere(viewer, q);
  const [rows, total] = await Promise.all([
    db.approvalRequest.findMany({ where, include: approvalInclude, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.approvalRequest.count({ where }),
  ]);
  return { data: rows.map((a) => toApprovalDto(a, viewer)), page: q.page, page_size: q.page_size, total };
}

// ---------------------------------------------------------------------------
// Request (FR-APP-01) and cancel (FR-APP-06)
// ---------------------------------------------------------------------------

async function pmReplyTo(project) {
  const pm = await db.user.findUnique({ where: { id: project.pm_user_id }, select: { email: true } });
  return pm?.email; // BR-NOT-02: contacts reply to the PM
}

export async function requestApproval(viewer, body, req) {
  let subject;
  if (body.file_version_id) {
    const v = isUuid(body.file_version_id) ? await db.fileVersion.findFirst({ where: { id: body.file_version_id, workspace_id: viewer.workspace_id, deleted_at: null }, include: { file: true } }) : null;
    if (!v || v.file.deleted_at) throw fieldError('file_version_id', 'Choose a file version of this workspace');
    subject = { projectId: v.file.project_id, fileVersion: v };
  } else {
    const t = isUuid(body.task_id) ? await db.task.findFirst({ where: { id: body.task_id, workspace_id: viewer.workspace_id, deleted_at: null } }) : null;
    if (!t) throw fieldError('task_id', 'Choose a task of this workspace');
    subject = { projectId: t.project_id, task: t };
  }
  const project = await db.project.findFirst({ where: { id: subject.projectId, deleted_at: null }, include: projectInclude });
  if (!project) throw notFound();
  const membership = await membershipOf(viewer, project.id);
  const ctx = { project, membership, record: project };
  if (!can(viewer, 'approval.request', ctx)) throw forbidden();
  if (project.archived_at) throw conflict('This project is archived and read-only. Unarchive it first.');
  if (!project.portal_enabled) throw conflict('Turn on the client portal for this project first');

  // Only what the client can see can be sent for approval (FR-APP-01)
  if (subject.fileVersion) {
    if (subject.fileVersion.file.visibility !== 'Client') throw fieldError('file_version_id', 'Share the file with the client first');
    if (subject.fileVersion.scan_status !== 'Clean') throw fieldError('file_version_id', 'This version is not ready yet (virus scan)');
    const latest = await db.fileVersion.findFirst({ where: { file_id: subject.fileVersion.file_id, deleted_at: null }, orderBy: { version_no: 'desc' }, select: { id: true } });
    if (latest.id !== subject.fileVersion.id) throw fieldError('file_version_id', 'Only the latest version can be sent for approval');
  } else if (subject.task.visibility !== 'Client') {
    throw fieldError('task_id', 'Make the task visible to the client first');
  }
  const open = await db.approvalRequest.count({ where: { status: PENDING, ...(subject.fileVersion ? { file_version_id: subject.fileVersion.id } : { task_id: subject.task.id }) } });
  if (open) throw conflict('An approval is already pending for this item');

  // BR-APP-02: approvers are contacts of this project with Approve level and portal access
  const members = await db.projectMember.findMany({
    where: { project_id: project.id, contact_id: { in: body.approver_contact_ids }, portal_level: 'Approve', contact: { portal_access: true, anonymised_at: null, client_id: project.client_id } },
    select: { contact_id: true },
  });
  const ok = new Set(members.map((m) => m.contact_id));
  const bad = body.approver_contact_ids.filter((id) => !ok.has(id));
  if (bad.length) throw new AppError(422, 'VALIDATION_ERROR', 'Approvers must be client contacts on this project with Approve level and portal access', bad.map(() => ({ field: 'approver_contact_ids', message: 'Not an approver on this project' })));
  if (body.due_date && body.due_date < workspaceToday(await db.workspace.findUniqueOrThrow({ where: { id: project.workspace_id }, select: { timezone: true } }))) {
    throw fieldError('due_date', 'The due date cannot be in the past');
  }

  const replyTo = await pmReplyTo(project);
  const created = await db.$transaction(async (tx) => {
    const a = await tx.approvalRequest.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: project.id,
        file_version_id: subject.fileVersion?.id ?? null,
        task_id: subject.task?.id ?? null,
        requested_by: viewer.id,
        rule: body.rule,
        due_date: toDbDate(body.due_date ?? null),
        message: body.message ?? null,
        created_by: viewer.id,
        updated_by: viewer.id,
        approvers: { create: body.approver_contact_ids.map((contact_id) => ({ workspace_id: project.workspace_id, contact_id, created_by: viewer.id, updated_by: viewer.id })) },
      },
    });
    const name = subject.fileVersion ? `${subject.fileVersion.file.name} (version ${subject.fileVersion.version_no})` : subject.task.title;
    await notify(tx, {
      workspaceId: project.workspace_id,
      event: 'approval_requested',
      actorId: viewer.id,
      contactIds: body.approver_contact_ids,
      entityType: 'Approval',
      entityId: a.id,
      payload: {
        title: `${viewer.full_name} asks for your approval: ${name}`,
        subject: `Approval requested: ${name}`,
        text: `${viewer.full_name} asks you to review "${name}" in ${project.name}${body.due_date ? ` by ${body.due_date}` : ''}.${body.message ? ` Message: ${body.message}` : ''}`,
        link: `/portal/approvals/${a.id}`,
        reply_to: replyTo,
      },
    });
    await writeAudit({ req, action: 'approval.requested', entityType: 'Approval', entityId: a.id, projectId: project.id, clientId: project.client_id, after: { subject: subject.fileVersion ? 'file' : 'task', name, rule: body.rule, approvers: body.approver_contact_ids.length, due_date: body.due_date ?? null } }, tx);
    return a;
  });
  return toApprovalDto(await db.approvalRequest.findUniqueOrThrow({ where: { id: created.id }, include: approvalInclude }), viewer, ctx);
}

export async function cancelApproval(viewer, ctx, req) {
  const a = ctx.approval;
  if (a.status !== PENDING) throw conflict('Only a pending approval can be cancelled'); // BR-APP-01
  const res = await db.$transaction(async (tx) => {
    const r = await tx.approvalRequest.updateMany({ where: { id: a.id, status: PENDING }, data: { status: APPROVAL_STATUS.CANCELLED, cancelled_at: new Date(), updated_by: viewer.id, version: { increment: 1 } } });
    if (r.count !== 1) throw conflict('This approval was decided or cancelled meanwhile');
    await notify(tx, {
      workspaceId: a.workspace_id,
      event: 'approval_cancelled',
      actorId: viewer.id,
      contactIds: a.approvers.filter((x) => !x.decision).map((x) => x.contact_id),
      entityType: 'Approval',
      entityId: a.id,
      payload: { title: `${viewer.full_name} cancelled the approval request for ${subjectOf(a).file?.name ?? subjectOf(a).task?.title}`, link: `/portal/approvals/${a.id}`, reply_to: await pmReplyTo(a.project) },
    });
    await writeAudit({ req, action: 'approval.cancelled', entityType: 'Approval', entityId: a.id, projectId: a.project_id, clientId: a.project.client_id, before: { status: PENDING }, after: { status: APPROVAL_STATUS.CANCELLED } }, tx);
    return r;
  });
  return res;
}

// ---------------------------------------------------------------------------
// Pins (FR-APP-02)
// ---------------------------------------------------------------------------

export async function addPin(viewer, approval, { page, x, y, body }, req) {
  if (approval.status !== PENDING) throw conflict('Pins can be added only while the approval is pending'); // BR-APP-01
  if (!approval.file_version) throw conflict('Pins are for files; comment on the task instead');
  const pin = await db.$transaction(async (tx) => {
    const last = await tx.approvalPin.findFirst({ where: { approval_request_id: approval.id }, orderBy: { number: 'desc' }, select: { number: true } });
    const p = await tx.approvalPin.create({
      data: {
        workspace_id: approval.workspace_id,
        approval_request_id: approval.id,
        number: (last?.number ?? 0) + 1,
        page,
        x,
        y,
        body,
        author_user_id: viewer.kind === 'user' ? viewer.id : null,
        author_contact_id: viewer.kind === 'contact' ? viewer.id : null,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
      include: { author_user: { select: { id: true, full_name: true } }, author_contact: { select: { id: true, full_name: true } } },
    });
    await writeAudit({ req, action: 'approval.pin_added', entityType: 'Approval', entityId: approval.id, projectId: approval.project_id, clientId: approval.project.client_id, after: { number: p.number, page } }, tx);
    return p;
  });
  return pinDto(pin);
}

/** Signed link for the proofing viewer (inline when previewable). */
export async function proofUrl(approval, req) {
  const v = approval.file_version;
  if (!v) throw notFound('This approval has no file');
  if (v.scan_status !== 'Clean') throw conflict('This file is still being scanned for viruses');
  const inline = PREVIEWABLE_TYPES.includes(v.mime_type);
  const link = await getFileUrl(v.storage_key, { filename: v.original_name, inline, contentType: v.mime_type });
  await writeAudit({ req, action: 'file.downloaded', entityType: 'File', entityId: v.file.id, projectId: approval.project_id, clientId: approval.project.client_id, after: { version_no: v.version_no, inline, via: 'approval' } });
  return { ...link, inline, mime_type: v.mime_type };
}

// ---------------------------------------------------------------------------
// Decide (FR-APP-03/04, BR-APP-01/02/03)
// ---------------------------------------------------------------------------

/**
 * The final status after one more decision, or null while still pending.
 * Any: the first approval approves. All: approved when everyone approved.
 * Either way, one "Request changes" ends the round (FR-APP-04).
 */
export function outcome(rule, decisions, approverCount) {
  if (decisions.includes('ChangesRequested')) return APPROVAL_STATUS.CHANGES_REQUESTED;
  if (rule === 'Any' && decisions.includes('Approved')) return APPROVAL_STATUS.APPROVED;
  if (rule === 'All' && decisions.length === approverCount && decisions.every((d) => d === 'Approved')) return APPROVAL_STATUS.APPROVED;
  return null;
}

export async function decide(contact, approval, { decision, note }, req) {
  if (approval.status !== PENDING) throw conflict('This approval is already decided and cannot change'); // BR-APP-01, TC-APP-003
  const mine = approval.approvers.find((x) => x.contact_id === contact.id);
  if (!mine) throw forbidden('You are not an approver of this request');
  if (mine.decision) throw conflict('You have already decided');
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    const r = await tx.approvalApprover.updateMany({ where: { id: mine.id, decision: null }, data: { decision, decision_note: note ?? null, decided_at: now, decision_ip: req.ip ?? null, updated_by: contact.id } });
    if (r.count !== 1) throw conflict('You have already decided');
    const all = await tx.approvalApprover.findMany({ where: { approval_request_id: approval.id } });
    const final = outcome(approval.rule, all.map((x) => x.decision).filter(Boolean), all.length);
    await writeAudit({ req, actor: { type: 'Contact', id: contact.id }, action: 'approval.decision', entityType: 'Approval', entityId: approval.id, projectId: approval.project_id, clientId: approval.project.client_id, after: { decision, note: note ?? null, by: contact.full_name, final } }, tx);
    if (!final) return null;

    const done = await tx.approvalRequest.updateMany({ where: { id: approval.id, status: PENDING }, data: { status: final, decision_by: contact.id, decision_at: now, decision_note: note ?? null, updated_by: contact.id, version: { increment: 1 } } });
    if (done.count !== 1) throw conflict('This approval was decided or cancelled meanwhile');
    const subject = subjectOf(approval);
    const name = subject.file ? `${subject.file.name} (version ${subject.version_no})` : subject.task.title;
    await notify(tx, {
      workspaceId: approval.workspace_id,
      event: 'approval_decided',
      actorId: contact.id,
      userIds: [approval.requested_by, approval.project.pm_user_id],
      internal: true,
      entityType: 'Approval',
      entityId: approval.id,
      payload: {
        title: final === APPROVAL_STATUS.APPROVED ? `${contact.full_name} approved ${name}` : `${contact.full_name} requested changes to ${name}`,
        subject: `${final === APPROVAL_STATUS.APPROVED ? 'Approved' : 'Changes requested'}: ${name}`,
        text: `${contact.full_name} ${final === APPROVAL_STATUS.APPROVED ? 'approved' : 'requested changes to'} "${name}" in ${approval.project.name}.${note ? ` Note: ${note}` : ''}`,
        link: `/approvals/${approval.id}`,
      },
    });
    // BR-APP-03: approving closes the linked task (In Review → Done) when the PM turned it on
    if (final === APPROVAL_STATUS.APPROVED && approval.project.close_task_on_approval) {
      const taskId = approval.task?.id ?? approval.file_version?.file.task_id;
      if (taskId) await closeTask(tx, taskId, contact, approval, req);
    }
    return final;
  });
  return result;
}

async function closeTask(tx, taskId, contact, approval, req) {
  const task = await tx.task.findFirst({ where: { id: taskId, deleted_at: null } });
  if (!task || task.status !== TASK_STATUS.IN_REVIEW) return;
  const open = await tx.task.count({ where: { parent_task_id: task.id, deleted_at: null, status: { notIn: [TASK_STATUS.DONE, TASK_STATUS.CANCELLED] } } });
  if (open) return; // BR-TSK-02: a task with open subtasks stays for the team to finish
  await tx.task.update({ where: { id: task.id }, data: { status: TASK_STATUS.DONE, completed_at: new Date(), version: { increment: 1 } } });
  if (!task.parent_task_id) await recalculateProgress(task.project_id, tx);
  await writeAudit({ req, actor: { type: 'System', id: null }, action: 'task.status_changed', entityType: 'Task', entityId: task.id, projectId: task.project_id, clientId: approval.project.client_id, before: { status: task.status }, after: { status: TASK_STATUS.DONE, reason: 'approval', approval_id: approval.id } }, tx);
  await taskStatusChanged(tx, { task, project: approval.project, from: task.status, to: TASK_STATUS.DONE, viewer: { id: contact.id, full_name: contact.full_name } });
}

// ---------------------------------------------------------------------------
// Reminders (FR-APP-07): one day before and on the due date, while pending
// ---------------------------------------------------------------------------

export async function sendApprovalReminders(now = new Date()) {
  const workspaces = await db.workspace.findMany({ select: { id: true, timezone: true } });
  let sent = 0;
  for (const ws of workspaces) {
    const today = workspaceToday(ws, now);
    const tomorrow = addDays(today, 1);
    const due = await db.approvalRequest.findMany({
      where: {
        workspace_id: ws.id,
        status: PENDING,
        OR: [
          { due_date: toDbDate(tomorrow), reminded_before_at: null },
          { due_date: toDbDate(today), reminded_due_at: null },
        ],
      },
      include: approvalInclude,
    });
    for (const a of due) {
      const isToday = fromDbDate(a.due_date) === today;
      const subject = subjectOf(a);
      const name = subject.file ? subject.file.name : subject.task.title;
      await db.$transaction(async (tx) => {
        const claimed = await tx.approvalRequest.updateMany({ where: { id: a.id, status: PENDING, ...(isToday ? { reminded_due_at: null } : { reminded_before_at: null }) }, data: isToday ? { reminded_due_at: now } : { reminded_before_at: now } });
        if (claimed.count !== 1) return;
        sent += await notify(tx, {
          workspaceId: ws.id,
          event: 'approval_reminder',
          contactIds: a.approvers.filter((x) => !x.decision).map((x) => x.contact_id),
          entityType: 'Approval',
          entityId: a.id,
          payload: {
            title: isToday ? `Reminder: your approval of ${name} is due today` : `Reminder: your approval of ${name} is due tomorrow`,
            subject: `Reminder: approval of ${name} due ${isToday ? 'today' : 'tomorrow'}`,
            text: `${a.project.name}: please approve or request changes to "${name}" by ${fromDbDate(a.due_date)}.`,
            link: `/portal/approvals/${a.id}`,
            reply_to: await pmReplyTo(a.project),
          },
        });
      });
    }
  }
  return sent;
}
