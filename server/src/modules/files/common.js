// Shared pieces of the files module: loading a file for authorize() and the public shape.
import { PREVIEWABLE_TYPES } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { membershipOf, projectInclude } from '../projects/common.js';

export const versionInclude = {
  uploaded_by_user: { select: { id: true, full_name: true } },
  uploaded_by_contact: { select: { id: true, full_name: true } },
};

export const fileInclude = {
  folder: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
  versions: { where: { deleted_at: null }, orderBy: { version_no: 'desc' }, include: versionInclude },
};

/** authorize() loader for /files/:fileId routes. Contacts never see Internal files (BR-CLI-01). */
export async function loadFileContext(req, fileId = req.params.fileId) {
  const file = isUuid(fileId) ? await db.file.findFirst({ where: { id: fileId, workspace_id: req.principal.workspace_id, deleted_at: null }, include: fileInclude }) : null;
  if (!file) throw notFound('File not found');
  const project = await db.project.findFirst({ where: { id: file.project_id, deleted_at: null }, include: projectInclude });
  if (!project) throw notFound('File not found');
  const membership = await membershipOf(req.principal, project.id);
  return { project, membership, file, record: file };
}

const versionDto = (v) => ({
  id: v.id,
  version_no: v.version_no,
  original_name: v.original_name,
  mime_type: v.mime_type,
  size_bytes: Number(v.size_bytes),
  scan_status: v.scan_status,
  previewable: PREVIEWABLE_TYPES.includes(v.mime_type), // FR-FILE-03; SVG is download-only (D-34 c)
  uploaded_by: v.uploaded_by_user ?? v.uploaded_by_contact ?? null,
  created_at: v.created_at,
});

export function toFileDto(file, viewer, ctx) {
  const latest = file.versions[0] ?? null;
  const dto = {
    id: file.id,
    project_id: file.project_id,
    name: file.name,
    visibility: file.visibility,
    folder: file.folder ?? null,
    task: file.task ?? null,
    latest: latest ? versionDto(latest) : null,
    version_count: file.versions.length,
    created_by: file.created_by,
    created_at: file.created_at,
    updated_at: file.updated_at,
    version: file.version,
  };
  if (ctx) {
    const full = { ...ctx, record: file };
    dto.versions = file.versions.map(versionDto);
    dto.permissions = {
      update: can(viewer, 'file.update', full),
      delete: can(viewer, 'file.delete', full),
      upload_version: can(viewer, 'file.create', full),
    };
  }
  return dto;
}
