// Files: FR-FILE-01…07, BR-FILE-01…03, FR-PRJ-11 (stored objects of purged projects).
// Uploads stream through the API: the first bytes decide the type (415 on mismatch),
// the size is counted against the 100 MB limit and the workspace quota (413), the
// bytes go to object storage, then the version is virus-scanned. Only Clean versions
// can be downloaded.
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { APPROVAL_STATUS, PREVIEWABLE_TYPES, fileUploadNameSchema } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { config } from '../../config.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, conflict, fieldError, forbidden, notFound, staleUpdate } from '../../lib/errors.js';
import { HEAD_BYTES, allowedTypeFor, checkFileContent } from '../../lib/fileTypes.js';
import { logger } from '../../lib/logger.js';
import { follow, notify } from '../../lib/notify.js';
import { scanStream, scannerEnabled } from '../../lib/scanner.js';
import { deleteObject, getFileUrl, getObjectStream, uploadStream } from '../../lib/storage.js';
import { isUuid } from '../../lib/validate.js';
import { assertWritable } from '../projects/common.js';
import { fileInclude, toFileDto } from './common.js';

const DECIDED = [APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.CHANGES_REQUESTED];
export const FILE_PURGE_AFTER_DAYS = 30; // FR-FILE-06

const tooLarge = (message) => new AppError(413, 'PAYLOAD_TOO_LARGE', message, [{ field: 'file', message }]);
const normalize = (name) => name.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Quota (BR-FILE-03): one atomic statement, so parallel uploads cannot overshoot
// ---------------------------------------------------------------------------

async function reserveStorage(workspaceId, bytes) {
  const count = await db.$executeRaw`
    UPDATE workspaces SET storage_used_bytes = storage_used_bytes + ${bytes}
    WHERE id = ${workspaceId}::uuid AND storage_used_bytes + ${bytes} <= ${config.storage.quotaBytes}`;
  if (count !== 1) throw tooLarge('Storage limit reached');
}

export function releaseStorage(workspaceId, bytes, client = db) {
  if (!bytes) return Promise.resolve();
  return client.$executeRaw`UPDATE workspaces SET storage_used_bytes = GREATEST(storage_used_bytes - ${bytes}, 0) WHERE id = ${workspaceId}::uuid`;
}

// ---------------------------------------------------------------------------
// Receiving the bytes
// ---------------------------------------------------------------------------

/** Name and size from the request headers (raw body upload: Content-Length + X-File-Name). */
function uploadHeaders(req) {
  let name;
  try {
    name = decodeURIComponent(req.get('x-file-name') ?? '');
  } catch {
    throw fieldError('file', 'The file name is not valid');
  }
  const parsed = fileUploadNameSchema.safeParse(name);
  if (!parsed.success) throw fieldError('file', parsed.error.issues[0]?.message ?? 'Give the file a name');
  const size = Number(req.get('content-length'));
  if (!Number.isInteger(size) || size <= 0) throw fieldError('file', 'The file is empty');
  if (size > config.storage.fileMaxBytes) throw tooLarge(`Files can be at most ${Math.round(config.storage.fileMaxBytes / 1_048_576)} MB`); // FR-FILE-01
  allowedTypeFor(parsed.data); // TC-FILE-001: blocked extensions fail before any byte is stored
  return { name: parsed.data, size };
}

/**
 * Stream the request body to storage under `key`. Checks the content type from the
 * first bytes (BR-FILE-01) and that the body matches the declared size.
 */
async function receive(req, { name, size, key }) {
  const it = req[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  let ended = false;
  while (head.length < HEAD_BYTES) {
    const { value, done } = await it.next();
    if (done) {
      ended = true;
      break;
    }
    head = Buffer.concat([head, value]);
  }
  const mime = await checkFileContent(name, head.subarray(0, HEAD_BYTES)); // throws 415 (TC-FILE-002)

  const hash = createHash('sha256');
  const body = new PassThrough();
  let received = 0;
  const feed = async () => {
    const push = async (chunk) => {
      received += chunk.length;
      if (received > size) throw fieldError('file', 'The upload is larger than announced');
      hash.update(chunk);
      if (!body.write(chunk)) await new Promise((r) => body.once('drain', r));
    };
    try {
      await push(head);
      if (!ended) {
        for (;;) {
          const { value, done } = await it.next();
          if (done) break;
          await push(value);
        }
      }
      if (received !== size) throw fieldError('file', 'The upload was interrupted');
      body.end();
    } catch (err) {
      body.destroy(err);
      throw err;
    }
  };
  await Promise.all([uploadStream(key, body, mime), feed()]);
  return { mime, sha256: hash.digest('hex'), size: received };
}

// ---------------------------------------------------------------------------
// Scanning (BR-FILE-02, D-30)
// ---------------------------------------------------------------------------

/**
 * Scan one version and record the result. Infected versions are removed from
 * storage and the uploader is told. When the scanner is unreachable the version
 * stays Pending and the sweep job tries again.
 * @returns {Promise<'Clean'|'Infected'|'Pending'>}
 */
export async function scanVersion(versionId) {
  const v = await db.fileVersion.findUnique({ where: { id: versionId }, include: { file: true } });
  if (!v || v.scan_status !== 'Pending' || v.deleted_at) return v?.scan_status ?? 'Pending';
  if (!scannerEnabled()) {
    if (!config.scanner.devMarkClean) return 'Pending';
    await db.fileVersion.update({ where: { id: v.id }, data: { scan_status: 'Clean', scanned_at: new Date() } });
    return 'Clean';
  }
  let result;
  try {
    result = await scanStream(await getObjectStream(v.storage_key));
  } catch (err) {
    logger.warn({ err, versionId }, 'Virus scan failed; will retry');
    return 'Pending';
  }
  if (result.clean) {
    await db.fileVersion.update({ where: { id: v.id }, data: { scan_status: 'Clean', scanned_at: new Date() } });
    return 'Clean';
  }
  await db.$transaction(async (tx) => {
    await tx.fileVersion.update({ where: { id: v.id }, data: { scan_status: 'Infected', scanned_at: new Date(), deleted_at: new Date() } });
    const others = await tx.fileVersion.count({ where: { file_id: v.file_id, deleted_at: null } });
    if (others === 0) await tx.file.update({ where: { id: v.file_id }, data: { deleted_at: new Date() } });
    await releaseStorage(v.workspace_id, v.size_bytes, tx);
    await writeAudit({ workspaceId: v.workspace_id, action: 'file.infected', entityType: 'File', entityId: v.file_id, projectId: v.file.project_id, after: { version_no: v.version_no, signature: result.signature } }, tx);
    if (v.uploaded_by_user_id) {
      await notify(tx, {
        workspaceId: v.workspace_id,
        event: 'file_infected',
        userIds: [v.uploaded_by_user_id],
        internal: true,
        entityType: 'File',
        entityId: v.file_id,
        payload: { title: `"${v.original_name}" was rejected: a virus was found`, text: `The virus scanner found ${result.signature} in "${v.original_name}". The file was not kept.`, link: `/projects/${v.file.project_id}?tab=files` },
      });
    }
  });
  await deleteObject(v.storage_key).catch((err) => logger.warn({ err }, 'Could not remove infected object'));
  return 'Infected';
}

/** Sweep job: retry versions left Pending (scanner was down). */
export async function rescanPending({ olderThanMs = 60_000, limit = 20 } = {}) {
  const due = await db.fileVersion.findMany({ where: { scan_status: 'Pending', deleted_at: null, created_at: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true }, take: limit });
  let done = 0;
  for (const v of due) if ((await scanVersion(v.id)) !== 'Pending') done += 1;
  return done;
}

const infectedError = () =>
  new AppError(422, 'VALIDATION_ERROR', 'A virus was found. The file was rejected.', [{ field: 'file', message: 'A virus was found. The file was rejected.' }]);

// ---------------------------------------------------------------------------
// Upload (FR-FILE-01) and new version (FR-FILE-02)
// ---------------------------------------------------------------------------

async function assertTaskOfProject(projectId, taskId, { clientOnly = false } = {}) {
  if (!taskId) return;
  const t = await db.task.findFirst({ where: { id: taskId, project_id: projectId, deleted_at: null, ...(clientOnly ? { visibility: 'Client' } : {}) }, select: { id: true } });
  if (!t) throw fieldError('task_id', 'Choose a task of this project');
}
async function assertFolderOfProject(projectId, folderId) {
  if (!folderId) return;
  const f = await db.fileFolder.findFirst({ where: { id: folderId, project_id: projectId }, select: { id: true } });
  if (!f) throw fieldError('folder_id', 'Choose a folder of this project');
}

const storageKey = (project, fileId) => `ws/${project.workspace_id}/projects/${project.id}/files/${fileId}/${randomUUID()}`;

async function storeVersion(req, { project, name, size, fileId }) {
  await reserveStorage(project.workspace_id, size); // BR-FILE-03 (413)
  const key = storageKey(project, fileId);
  try {
    const got = await receive(req, { name, size, key });
    return { key, ...got };
  } catch (err) {
    await releaseStorage(project.workspace_id, size);
    await deleteObject(key).catch(() => {});
    throw err;
  }
}

export async function uploadFile(viewer, ctx, query, req) {
  const { project } = ctx;
  assertWritable(project);
  const isContact = viewer.kind === 'contact';
  if (!isContact && query.visibility && query.visibility !== 'Internal' && !can(viewer, 'file.update', ctx)) {
    throw forbidden('Only the project manager, an Admin or the Owner can share files with the client'); // FR-FILE-07
  }
  // D-44 (b): a contact's uploads are always Client-visible, never in a folder, only on Client tasks
  const visibility = isContact ? 'Client' : (query.visibility ?? 'Internal');
  if (isContact) query = { task_id: query.task_id };
  const { name, size } = uploadHeaders(req);
  await assertTaskOfProject(project.id, query.task_id, { clientOnly: isContact });
  await assertFolderOfProject(project.id, query.folder_id);

  const fileId = randomUUID();
  const stored = await storeVersion(req, { project, name, size, fileId });
  const version = await db.$transaction(async (tx) => {
    await tx.file.create({
      data: {
        id: fileId,
        workspace_id: project.workspace_id,
        project_id: project.id,
        task_id: query.task_id ?? null,
        folder_id: query.folder_id ?? null,
        name,
        visibility,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    const v = await tx.fileVersion.create({
      data: {
        workspace_id: project.workspace_id,
        file_id: fileId,
        version_no: 1,
        original_name: name,
        mime_type: stored.mime,
        size_bytes: BigInt(stored.size),
        sha256: stored.sha256,
        storage_key: stored.key,
        uploaded_by_user_id: viewer.kind === 'user' ? viewer.id : null,
        uploaded_by_contact_id: viewer.kind === 'contact' ? viewer.id : null,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    await follow(tx, { workspaceId: project.workspace_id, entityType: 'File', entityId: fileId, userIds: viewer.kind === 'user' ? [viewer.id] : [], contactIds: viewer.kind === 'contact' ? [viewer.id] : [], actorId: viewer.id });
    await writeAudit({ req, action: 'file.uploaded', entityType: 'File', entityId: fileId, projectId: project.id, clientId: project.client_id, after: { name, size_bytes: stored.size, mime_type: stored.mime, visibility } }, tx);
    return v;
  });
  if ((await scanVersion(version.id)) === 'Infected') throw infectedError();
  return getFile(viewer, { ...ctx, file: await reload(fileId) });
}

export async function uploadVersion(viewer, ctx, req) {
  const { project, file } = ctx;
  assertWritable(project);
  const { name, size } = uploadHeaders(req);
  const stored = await storeVersion(req, { project, name, size, fileId: file.id });
  const version = await db.$transaction(async (tx) => {
    const last = await tx.fileVersion.findFirst({ where: { file_id: file.id }, orderBy: { version_no: 'desc' }, select: { version_no: true } });
    const v = await tx.fileVersion.create({
      data: {
        workspace_id: project.workspace_id,
        file_id: file.id,
        version_no: (last?.version_no ?? 0) + 1,
        original_name: name,
        mime_type: stored.mime,
        size_bytes: BigInt(stored.size),
        sha256: stored.sha256,
        storage_key: stored.key,
        uploaded_by_user_id: viewer.kind === 'user' ? viewer.id : null,
        uploaded_by_contact_id: viewer.kind === 'contact' ? viewer.id : null,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    // FR-FILE-02, TC-FILE-004: open approvals on older versions are superseded
    const superseded = await tx.approvalRequest.updateMany({
      where: { file_version: { file_id: file.id }, status: APPROVAL_STATUS.PENDING },
      data: { status: APPROVAL_STATUS.SUPERSEDED, updated_by: viewer.id },
    });
    await tx.file.update({ where: { id: file.id }, data: { updated_by: viewer.id, version: { increment: 1 } } });
    await writeAudit({ req, action: 'file.version_uploaded', entityType: 'File', entityId: file.id, projectId: project.id, clientId: project.client_id, after: { version_no: v.version_no, size_bytes: stored.size, superseded_approvals: superseded.count } }, tx);
    return v;
  });
  if ((await scanVersion(version.id)) === 'Infected') throw infectedError();
  return getFile(viewer, { ...ctx, file: await reload(file.id) });
}

const reload = (id) => db.file.findUniqueOrThrow({ where: { id }, include: fileInclude });

// ---------------------------------------------------------------------------
// Read, download (FR-FILE-03/04), list
// ---------------------------------------------------------------------------

export function getFile(viewer, ctx) {
  return toFileDto(ctx.file, viewer, ctx);
}

export async function listFiles(viewer, ctx, q) {
  const where = {
    project_id: ctx.project.id,
    deleted_at: null,
    ...(viewer.kind === 'contact' ? { visibility: 'Client' } : {}),
    ...(q.folder === 'root' ? { folder_id: null } : q.folder ? { folder_id: q.folder } : {}),
    ...(q.task_id ? { task_id: q.task_id } : {}),
    ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    versions: { some: { deleted_at: null } },
  };
  const [rows, total] = await Promise.all([
    db.file.findMany({ where, include: fileInclude, orderBy: [{ updated_at: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.file.count({ where }),
  ]);
  return { data: rows.map((f) => toFileDto(f, viewer)), page: q.page, page_size: q.page_size, total };
}

export async function downloadUrl(viewer, ctx, versionNo, { inline = false } = {}, req) {
  const no = Number(versionNo);
  const v = Number.isInteger(no) ? ctx.file.versions.find((x) => x.version_no === no) : null;
  if (!v) throw notFound('Version not found');
  if (v.scan_status === 'Pending') throw conflict('This file is still being scanned for viruses. Try again in a moment.'); // D-30
  if (v.scan_status !== 'Clean') throw notFound('Version not found');
  const showInline = inline && PREVIEWABLE_TYPES.includes(v.mime_type); // SVG never inline (D-34 c)
  const link = await getFileUrl(v.storage_key, { filename: v.original_name, inline: showInline, contentType: v.mime_type });
  await writeAudit({ req, action: 'file.downloaded', entityType: 'File', entityId: ctx.file.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { version_no: v.version_no, inline: showInline } });
  return { ...link, inline: showInline };
}

// ---------------------------------------------------------------------------
// Edit (FR-FILE-05/07), delete (FR-FILE-06), purge
// ---------------------------------------------------------------------------

export async function updateFile(viewer, ctx, { version, ...changes }, req) {
  const { project, file } = ctx;
  assertWritable(project);
  if (!Object.keys(changes).length) throw fieldError(null, 'Nothing to update');
  if (changes.task_id) await assertTaskOfProject(project.id, changes.task_id);
  if (changes.folder_id) await assertFolderOfProject(project.id, changes.folder_id);
  const res = await db.file.updateMany({ where: { id: file.id, version, deleted_at: null }, data: { ...changes, version: { increment: 1 }, updated_by: viewer.id } });
  if (res.count !== 1) throw staleUpdate();
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, file[k]]));
  await writeAudit({ req, action: changes.visibility && changes.visibility !== file.visibility ? 'file.visibility_changed' : 'file.updated', entityType: 'File', entityId: file.id, projectId: project.id, clientId: project.client_id, before, after: changes });
  return getFile(viewer, { ...ctx, file: await reload(file.id) });
}

export async function deleteFile(viewer, ctx, req) {
  const { project, file } = ctx;
  assertWritable(project);
  // FR-FILE-06: a version with a decided approval keeps the file
  const decided = await db.approvalRequest.count({ where: { file_version: { file_id: file.id }, status: { in: DECIDED } } });
  if (decided) throw conflict('This file has a decided approval and cannot be deleted');
  await db.$transaction(async (tx) => {
    await tx.file.update({ where: { id: file.id }, data: { deleted_at: new Date(), updated_by: viewer.id, version: { increment: 1 } } });
    await writeAudit({ req, action: 'file.deleted', entityType: 'File', entityId: file.id, projectId: project.id, clientId: project.client_id, before: { name: file.name } }, tx);
  });
}

/** Remove the stored objects and rows of files deleted more than 30 days ago. */
export async function purgeDeletedFiles(now = new Date()) {
  const cutoff = new Date(now.getTime() - FILE_PURGE_AFTER_DAYS * 86_400_000);
  const files = await db.file.findMany({ where: { deleted_at: { lt: cutoff } }, select: { id: true } });
  let purged = 0;
  for (const f of files) {
    const decided = await db.approvalRequest.count({ where: { file_version: { file_id: f.id }, status: { in: DECIDED } } });
    if (decided) continue; // approval history is never lost
    if (await removeFilesForGood([f.id])) purged += 1;
  }
  return purged;
}

/**
 * Delete files, their versions and stored objects for good, and give the bytes back
 * to the quota. Used by the file purge and by the project purge (FR-PRJ-11).
 */
export async function removeFilesForGood(fileIds, tx = null) {
  if (!fileIds.length) return tx ? [] : 0;
  const run = async (t) => {
    const versions = await t.fileVersion.findMany({ where: { file_id: { in: fileIds } }, select: { id: true, workspace_id: true, storage_key: true, size_bytes: true, scan_status: true } });
    const ws = versions[0]?.workspace_id;
    // Infected versions were already released when they were found
    const bytes = versions.filter((v) => v.scan_status !== 'Infected').reduce((n, v) => n + v.size_bytes, 0n);
    await t.approvalRequest.deleteMany({ where: { file_version_id: { in: versions.map((v) => v.id) } } });
    await t.expense.updateMany({ where: { receipt_file_id: { in: fileIds } }, data: { receipt_file_id: null } });
    await t.fileVersion.deleteMany({ where: { file_id: { in: fileIds } } });
    await t.file.deleteMany({ where: { id: { in: fileIds } } });
    if (ws) await releaseStorage(ws, bytes, t);
    return versions.map((v) => v.storage_key);
  };
  const keys = tx ? await run(tx) : await db.$transaction(run);
  // Objects go after the rows commit; a failure only leaves an orphan object, never a broken row
  if (!tx) await Promise.all(keys.map((k) => deleteObject(k).catch((err) => logger.warn({ err, key: k }, 'Could not remove stored object'))));
  return tx ? keys : fileIds.length;
}

// ---------------------------------------------------------------------------
// Folders (FR-FILE-05): one level per project
// ---------------------------------------------------------------------------

export async function listFolders(ctx) {
  const rows = await db.fileFolder.findMany({ where: { project_id: ctx.project.id }, orderBy: { name_normalized: 'asc' }, include: { _count: { select: { files: { where: { deleted_at: null } } } } } });
  return { data: rows.map((f) => ({ id: f.id, name: f.name, file_count: f._count.files, version: f.version })) };
}

export async function createFolder(viewer, ctx, { name }, req) {
  assertWritable(ctx.project);
  if (await db.fileFolder.findFirst({ where: { project_id: ctx.project.id, name_normalized: normalize(name) } })) throw conflict('A folder with this name already exists', [{ field: 'name', message: 'Already used in this project' }]);
  const f = await db.fileFolder.create({ data: { workspace_id: ctx.project.workspace_id, project_id: ctx.project.id, name, name_normalized: normalize(name), created_by: viewer.id, updated_by: viewer.id } });
  await writeAudit({ req, action: 'folder.created', entityType: 'Folder', entityId: f.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { name } });
  return { id: f.id, name: f.name, file_count: 0, version: f.version };
}

async function findFolder(ctx, folderId) {
  const f = isUuid(folderId) ? await db.fileFolder.findFirst({ where: { id: folderId, project_id: ctx.project.id } }) : null;
  if (!f) throw notFound('Folder not found');
  return f;
}

export async function renameFolder(viewer, ctx, folderId, { name, version }, req) {
  assertWritable(ctx.project);
  const f = await findFolder(ctx, folderId);
  const clash = await db.fileFolder.findFirst({ where: { project_id: ctx.project.id, name_normalized: normalize(name), id: { not: f.id } } });
  if (clash) throw conflict('A folder with this name already exists', [{ field: 'name', message: 'Already used in this project' }]);
  const res = await db.fileFolder.updateMany({ where: { id: f.id, version }, data: { name, name_normalized: normalize(name), version: { increment: 1 }, updated_by: viewer.id } });
  if (res.count !== 1) throw staleUpdate();
  await writeAudit({ req, action: 'folder.renamed', entityType: 'Folder', entityId: f.id, projectId: ctx.project.id, clientId: ctx.project.client_id, before: { name: f.name }, after: { name } });
  return { id: f.id, name, version: version + 1 };
}

/** Deleting a folder keeps its files: they move to the project root. */
export async function deleteFolder(viewer, ctx, folderId, req) {
  assertWritable(ctx.project);
  const f = await findFolder(ctx, folderId);
  await db.$transaction(async (tx) => {
    const moved = await tx.file.updateMany({ where: { folder_id: f.id }, data: { folder_id: null, updated_by: viewer.id } });
    await tx.fileFolder.delete({ where: { id: f.id } });
    await writeAudit({ req, action: 'folder.deleted', entityType: 'Folder', entityId: f.id, projectId: ctx.project.id, clientId: ctx.project.client_id, before: { name: f.name }, after: { files_moved_to_root: moved.count } }, tx);
  });
}

/** Workspace storage use for the settings page (BR-FILE-03). */
export async function storageUsage(workspaceId) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { storage_used_bytes: true } });
  return { used_bytes: Number(ws.storage_used_bytes), quota_bytes: config.storage.quotaBytes, file_max_bytes: config.storage.fileMaxBytes };
}
