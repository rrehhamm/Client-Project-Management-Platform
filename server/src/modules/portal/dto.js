// Portal response shapes (D-40, FR-PORT-02, TC-PORT-003). Each one is an allow list:
// fields not written here (estimates, time, cost, billable flags, internal notes,
// workload, ids of internal users, versions for editing) can never reach a contact.
import { PORTAL_LEVEL_ORDER, PREVIEWABLE_TYPES } from '@cpm/shared';
import { fromDbDate } from '../../lib/dates.js';

const levelAtLeast = (level, wanted) => PORTAL_LEVEL_ORDER.indexOf(level) >= PORTAL_LEVEL_ORDER.indexOf(wanted);

export function portalProjectDto(p, membership, extra = {}) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    progress_pct: p.progress_pct,
    start_date: fromDbDate(p.start_date),
    due_date: fromDbDate(p.due_date),
    archived: Boolean(p.archived_at),
    pm: p.pm_user ? { full_name: p.pm_user.full_name } : null,
    my_level: membership?.portal_level ?? null,
    can_comment: levelAtLeast(membership?.portal_level, 'Comment'),
    can_approve: levelAtLeast(membership?.portal_level, 'Approve'),
    ...extra,
  };
}

export const portalMilestoneDto = (m) => ({ id: m.id, title: m.title, due_date: fromDbDate(m.due_date), status: m.status });

/** D-44 (a): assignee names only, never workload. */
export function portalTaskDto(t, { parentVisible = false, counts } = {}) {
  return {
    id: t.id,
    project_id: t.project_id,
    parent_task_id: parentVisible ? t.parent_task_id : null,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    start_date: fromDbDate(t.start_date),
    due_date: fromDbDate(t.due_date),
    milestone: t.milestone && t.milestone.visibility === 'Client' && !t.milestone.deleted_at ? { id: t.milestone.id, title: t.milestone.title } : null,
    assignees: (t.assignees ?? []).map((a) => ({ full_name: a.user.full_name })),
    is_client_request: t.is_client_request,
    subtask_count: counts?.subtasks ?? 0,
    open_subtask_count: counts?.open ?? 0,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

const versionDto = (v) => ({
  version_no: v.version_no,
  original_name: v.original_name,
  mime_type: v.mime_type,
  size_bytes: Number(v.size_bytes),
  scan_status: v.scan_status,
  previewable: PREVIEWABLE_TYPES.includes(v.mime_type),
  uploaded_by: (v.uploaded_by_user ?? v.uploaded_by_contact) ? { full_name: (v.uploaded_by_user ?? v.uploaded_by_contact).full_name } : null,
  created_at: v.created_at,
});

export function portalFileDto(f, { withVersions = false } = {}) {
  const versions = f.versions ?? [];
  return {
    id: f.id,
    project_id: f.project_id,
    name: f.name,
    task: f.task && f.task.visibility === 'Client' && !f.task.deleted_at ? { id: f.task.id, title: f.task.title } : null,
    latest: versions[0] ? versionDto(versions[0]) : null,
    version_count: versions.length,
    ...(withVersions ? { versions: versions.map(versionDto) } : {}),
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}

/** Comments in the portal: author names only, no internal ids (D-40). */
export function portalCommentDto(c) {
  return {
    id: c.id,
    entity_type: c.entity_type,
    entity_id: c.entity_id,
    parent_id: c.parent_id,
    body: c.body,
    deleted: c.deleted,
    visibility: c.visibility,
    author: c.author ? { kind: c.author.kind, full_name: c.author.full_name } : null,
    mentions: c.mentions.map((m) => ({ full_name: m.full_name })),
    attachments: c.attachments,
    edited: c.edited,
    reply_count: c.reply_count,
    created_at: c.created_at,
    version: c.version,
    can_edit: Boolean(c.permissions?.edit),
    can_delete: Boolean(c.permissions?.delete),
  };
}
