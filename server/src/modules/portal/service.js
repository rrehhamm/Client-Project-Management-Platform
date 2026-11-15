// Client portal: FR-PORT-01…05/07/08, FR-CON-04, BR-CLI-01/02, D-40, D-44.
// Every query here is limited to the contact's own client, portal-enabled projects
// they belong to, and Client-visible items (scope.js).
import { ACTIVE_PROJECT_STATUSES, CLIENT_REQUEST_LABEL, TASK_STATUS } from '@cpm/shared';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { fieldError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { cleanRichText } from '../../lib/richText.js';
import { getFileUrl } from '../../lib/storage.js';
import { approvalInclude, loadApprovalContext, toPortalApprovalDto } from '../approvals/service.js';
import { assertWritable, projectInclude, recalculateProgress } from '../projects/common.js';
import { bottomPosition } from '../tasks/common.js';
import { portalFileDto, portalMilestoneDto, portalProjectDto, portalTaskDto } from './dto.js';
import { portalProjectWhere } from './scope.js';

const CLOSED = [TASK_STATUS.DONE, TASK_STATUS.CANCELLED];
const portalTaskInclude = {
  assignees: { include: { user: { select: { full_name: true } } }, orderBy: { created_at: 'asc' } },
  milestone: { select: { id: true, title: true, visibility: true, deleted_at: true } },
};
const portalFileInclude = {
  task: { select: { id: true, title: true, visibility: true, deleted_at: true } },
  versions: {
    where: { deleted_at: null },
    orderBy: { version_no: 'desc' },
    include: { uploaded_by_user: { select: { full_name: true } }, uploaded_by_contact: { select: { full_name: true } } },
  },
};
const clientFiles = (projectIds) => ({ project_id: { in: projectIds }, visibility: 'Client', deleted_at: null, versions: { some: { deleted_at: null } } });

/** FR-PORT-07: what the portal frame shows. */
export async function branding(contact) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: contact.workspace_id }, select: { name: true, logo_key: true, brand_color: true } });
  const client = await db.client.findUniqueOrThrow({ where: { id: contact.client_id }, select: { name: true } });
  return {
    workspace: { name: ws.name, brand_color: ws.brand_color, logo_url: ws.logo_key ? (await getFileUrl(ws.logo_key, { inline: true })).url : null },
    client: { name: client.name },
  };
}

async function myProjects(contact, where = {}) {
  const rows = await db.project.findMany({
    where: { ...portalProjectWhere(contact), ...where },
    include: { ...projectInclude, members: { where: { contact_id: contact.id } } },
    orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
  });
  return rows.map((p) => ({ row: p, membership: p.members[0] ?? null }));
}

/** Approvals waiting for this contact. */
const pendingForMe = (contact) => ({
  status: 'Pending',
  project: portalProjectWhere(contact),
  approvers: { some: { contact_id: contact.id, decision: null } },
  OR: [{ file_version: { file: { visibility: 'Client', deleted_at: null } } }, { task: { visibility: 'Client', deleted_at: null } }],
});

// ---------------------------------------------------------------------------
// Home (FR-PORT-01)
// ---------------------------------------------------------------------------

export async function home(contact) {
  const all = await myProjects(contact);
  const active = all.filter(({ row }) => ACTIVE_PROJECT_STATUSES.includes(row.status) && !row.archived_at);
  const ids = all.map(({ row }) => row.id);
  const [approvals, comments, files, done] = await Promise.all([
    db.approvalRequest.findMany({ where: pendingForMe(contact), include: approvalInclude, orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }], take: 20 }),
    db.comment.findMany({
      // Not their own comments; staff comments have no contact author (NULL), so test that explicitly
      where: { project_id: { in: ids }, visibility: 'Client', deleted_at: null, OR: [{ author_contact_id: null }, { author_contact_id: { not: contact.id } }] },
      include: { author_user: { select: { full_name: true } }, author_contact: { select: { full_name: true } }, project: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    db.file.findMany({ where: clientFiles(ids), include: { project: { select: { id: true, name: true } } }, orderBy: { updated_at: 'desc' }, take: 10 }),
    db.task.findMany({ where: { project_id: { in: ids }, visibility: 'Client', deleted_at: null, status: TASK_STATUS.DONE }, include: { project: { select: { id: true, name: true } } }, orderBy: { completed_at: 'desc' }, take: 10 }),
  ]);
  // Comments say where they were made, so the link can open that place
  const commentTarget = (c) => (c.entity_type === 'Task' ? `/portal/projects/${c.project.id}?task=${c.entity_id}` : c.entity_type === 'File' ? `/portal/projects/${c.project.id}?tab=files&file=${c.entity_id}` : `/portal/projects/${c.project.id}?tab=messages`);
  const updates = [
    ...comments.map((c) => ({ type: 'comment', at: c.created_at, project: c.project, title: `${(c.author_user ?? c.author_contact)?.full_name ?? ''} commented`, link: commentTarget(c) })),
    ...files.map((f) => ({ type: 'file', at: f.updated_at, project: f.project, title: `New file: ${f.name}`, link: `/portal/projects/${f.project.id}?tab=files&file=${f.id}` })),
    ...done.map((t) => ({ type: 'task_done', at: t.completed_at ?? t.updated_at, project: t.project, title: `Done: ${t.title}`, link: `/portal/projects/${t.project.id}?task=${t.id}` })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);
  return {
    projects: active.map(({ row, membership }) => portalProjectDto(row, membership)),
    awaiting: {
      approvals: approvals.map((a) => toPortalApprovalDto(a, contact)),
      // FR-PORT-06: proposals, contracts and invoices arrive in Phase 7
      contracts: [],
      invoices: [],
    },
    updates,
  };
}

export async function listProjects(contact) {
  return { data: (await myProjects(contact)).map(({ row, membership }) => portalProjectDto(row, membership)) };
}

// ---------------------------------------------------------------------------
// Project, tasks, files (FR-PORT-02)
// ---------------------------------------------------------------------------

export async function projectDetail(ctx) {
  const p = ctx.project;
  const [milestones, statusCounts] = await Promise.all([
    db.milestone.findMany({ where: { project_id: p.id, visibility: 'Client', deleted_at: null }, orderBy: [{ sort_order: 'asc' }, { due_date: 'asc' }] }),
    db.task.groupBy({ by: ['status'], where: { project_id: p.id, visibility: 'Client', deleted_at: null, parent_task_id: null }, _count: { _all: true } }),
  ]);
  return portalProjectDto(p, ctx.membership, {
    milestones: milestones.map(portalMilestoneDto),
    task_counts: Object.fromEntries(statusCounts.map((r) => [r.status, r._count._all])),
  });
}

async function subtaskCounts(ids) {
  if (!ids.length) return new Map();
  const rows = await db.task.groupBy({ by: ['parent_task_id', 'status'], where: { parent_task_id: { in: ids }, visibility: 'Client', deleted_at: null }, _count: { _all: true } });
  const out = new Map();
  for (const r of rows) {
    const c = out.get(r.parent_task_id) ?? { subtasks: 0, open: 0 };
    c.subtasks += r._count._all;
    if (!CLOSED.includes(r.status)) c.open += r._count._all;
    out.set(r.parent_task_id, c);
  }
  return out;
}

export async function listTasks(ctx, q) {
  const where = { project_id: ctx.project.id, visibility: 'Client', deleted_at: null, parent_task_id: null };
  const [rows, total] = await Promise.all([
    db.task.findMany({ where, include: portalTaskInclude, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.task.count({ where }),
  ]);
  const counts = await subtaskCounts(rows.map((t) => t.id));
  return { data: rows.map((t) => portalTaskDto(t, { counts: counts.get(t.id) })), page: q.page, page_size: q.page_size, total };
}

export async function taskDetail(ctx) {
  const t = await db.task.findUniqueOrThrow({ where: { id: ctx.task.id }, include: portalTaskInclude });
  const [subtasks, parent, files] = await Promise.all([
    db.task.findMany({ where: { parent_task_id: t.id, visibility: 'Client', deleted_at: null }, include: portalTaskInclude, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    t.parent_task_id ? db.task.findFirst({ where: { id: t.parent_task_id, visibility: 'Client', deleted_at: null }, select: { id: true, title: true } }) : null,
    db.file.findMany({ where: { ...clientFiles([t.project_id]), task_id: t.id }, include: portalFileInclude, orderBy: { updated_at: 'desc' } }),
  ]);
  return {
    ...portalTaskDto(t, { parentVisible: Boolean(parent) }),
    parent: parent ?? null,
    subtasks: subtasks.map((s) => portalTaskDto(s, { parentVisible: true })),
    files: files.map((f) => portalFileDto(f)),
  };
}

export async function listFiles(ctx, q) {
  const where = clientFiles([ctx.project.id]);
  const [rows, total] = await Promise.all([
    db.file.findMany({ where, include: portalFileInclude, orderBy: [{ updated_at: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.file.count({ where }),
  ]);
  return { data: rows.map((f) => portalFileDto(f)), page: q.page, page_size: q.page_size, total };
}

export async function fileDetail(fileId) {
  const f = await db.file.findUniqueOrThrow({ where: { id: fileId }, include: portalFileInclude });
  return portalFileDto(f, { withVersions: true });
}

// ---------------------------------------------------------------------------
// Client requests (FR-PORT-03)
// ---------------------------------------------------------------------------

export async function createRequest(contact, ctx, { title, description, attachment_file_ids: fileIds = [] }, req) {
  const p = ctx.project;
  assertWritable(p);
  const ids = [...new Set(fileIds)];
  if (ids.length) {
    // Only Client files of this project the contact may see
    const files = await db.file.findMany({ where: { id: { in: ids }, ...clientFiles([p.id]) }, select: { id: true } });
    if (files.length !== ids.length) throw fieldError('attachment_file_ids', 'Attach files you uploaded to this project');
  }
  const task = await db.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        workspace_id: p.workspace_id,
        project_id: p.id,
        title,
        description: cleanRichText(description ?? null),
        status: TASK_STATUS.TO_DO,
        visibility: 'Client',
        labels: [CLIENT_REQUEST_LABEL],
        is_client_request: true,
        requested_by_contact_id: contact.id,
        sort_order: await bottomPosition(p.id, null, tx),
        created_by: contact.id,
        updated_by: contact.id,
      },
    });
    if (ids.length) await tx.file.updateMany({ where: { id: { in: ids } }, data: { task_id: t.id, updated_by: contact.id } });
    await tx.follower.createMany({ data: [{ workspace_id: p.workspace_id, entity_type: 'Task', entity_id: t.id, contact_id: contact.id, created_by: contact.id, updated_by: contact.id }], skipDuplicates: true });
    await recalculateProgress(p.id, tx);
    await writeAudit({ req, action: 'task.client_requested', entityType: 'Task', entityId: t.id, projectId: p.id, clientId: p.client_id, after: { title, attachments: ids.length, by: contact.full_name } }, tx);
    await notify(tx, {
      workspaceId: p.workspace_id,
      event: 'client_request',
      actorId: contact.id,
      userIds: [p.pm_user_id],
      internal: true,
      entityType: 'Task',
      entityId: t.id,
      payload: {
        title: `${contact.full_name} sent a request: ${title}`,
        subject: `Client request: ${title}`,
        text: `${contact.full_name} (${p.client.name}) sent a request on ${p.code} · ${p.name}: "${title}".`,
        link: `/projects/${p.id}?tab=tasks&task=${t.id}`,
      },
    });
    return t;
  });
  return taskDetail({ task });
}

// ---------------------------------------------------------------------------
// Approvals (FR-PORT-05)
// ---------------------------------------------------------------------------

export async function listApprovals(contact, q) {
  const where = {
    project: portalProjectWhere(contact),
    approvers: { some: { contact_id: contact.id } },
    OR: [{ file_version: { file: { visibility: 'Client', deleted_at: null } } }, { task: { visibility: 'Client', deleted_at: null } }],
    ...(q.status ? { status: q.status } : {}),
  };
  const [rows, total] = await Promise.all([
    db.approvalRequest.findMany({ where, include: approvalInclude, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.approvalRequest.count({ where }),
  ]);
  return { data: rows.map((a) => toPortalApprovalDto(a, contact)), page: q.page, page_size: q.page_size, total };
}

/** authorize() loader for portal approvals. The subject must still be Client-visible (BR-CLI-02). */
export async function loadPortalApproval(req) {
  const ctx = await loadApprovalContext(req);
  const a = ctx.approval;
  const visible = a.file_version ? a.file_version.file.visibility === 'Client' && !a.file_version.file.deleted_at : a.task.visibility === 'Client' && !a.task.deleted_at;
  return {
    ...ctx,
    // Contacts read an approval like its project; Internal subjects are out of scope
    record: { ...ctx.project, visibility: visible ? 'Client' : 'Internal' },
    isApprover: a.approvers.some((x) => x.contact_id === req.principal.id),
  };
}
