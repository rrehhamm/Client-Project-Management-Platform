// API tests for files: FR-FILE-01…07, BR-FILE-01…03, TC-FILE-001…004, D-30, D-34 (c), FR-PRJ-11.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, STANDARD_ERROR, auditEntries } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { EICAR } = await import('../../lib/scanner.js');
const { getFileUrl } = await import('../../lib/storage.js');
const { purgeDeletedFiles } = await import('./service.js');
const { config } = await import('../../config.js');

const app = createApp();
let W;
let as;
let A;
let B;

beforeAll(async () => {
  W = await createWorld('Files');
  as = await W.loginAll(app);
  A = W.projects.A;
  B = W.projects.B;
});

const up = (c, project, name, buffer, query = '') => c.upload(`/api/v1/projects/${project.id}/files${query}`, buffer, { name });
const usage = async () => Number((await db.workspace.findUniqueOrThrow({ where: { id: W.workspace.id } })).storage_used_bytes);

describe('upload (FR-FILE-01, BR-FILE-01)', () => {
  it('a member uploads a file: listed with name, size, uploader and date; Internal by default; Clean after the scan', async () => {
    const before = await usage();
    const png = SAMPLE_FILES.png();
    const res = await up(as.TeamMember, A, 'logo draft.png', png);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'logo draft.png',
      visibility: 'Internal',
      version_count: 1,
      latest: { version_no: 1, mime_type: 'image/png', size_bytes: png.length, scan_status: 'Clean', previewable: true, uploaded_by: { id: W.users.member.id, full_name: 'Omar' } },
    });
    expect(await usage()).toBe(before + png.length); // BR-FILE-03 counter
    const list = await as.PM.get(`/api/v1/projects/${A.id}/files`);
    expect(list.body.data.map((f) => f.name)).toContain('logo draft.png');
    const [entry] = await auditEntries('file.uploaded', { entity_id: res.body.id });
    expect(entry.after).toMatchObject({ name: 'logo draft.png', size_bytes: png.length });
  });

  it('TC-FILE-001: invoice.exe is blocked with 415 and nothing is stored', async () => {
    const before = await usage();
    const res = await up(as.PM, A, 'invoice.exe', SAMPLE_FILES.exe());
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ ...STANDARD_ERROR, code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(await usage()).toBe(before);
  });

  it('TC-FILE-002: an exe renamed .pdf is blocked by the content check (415)', async () => {
    const before = await usage();
    const res = await up(as.PM, A, 'invoice.pdf', SAMPLE_FILES.exe());
    expect(res.status).toBe(415);
    expect(res.body.message).toMatch(/does not match \.pdf/);
    expect(await usage()).toBe(before); // the reservation was given back
    expect(await db.file.count({ where: { project_id: A.id, name: 'invoice.pdf' } })).toBe(0);
  });

  it('plain text must really be text; PDFs must start like PDFs', async () => {
    expect((await up(as.PM, A, 'notes.txt', SAMPLE_FILES.txt())).status).toBe(201);
    expect((await up(as.PM, A, 'binary.txt', Buffer.from([0, 1, 2, 3, 0, 0]))).status).toBe(415);
    expect((await up(as.PM, A, 'brief.pdf', SAMPLE_FILES.pdf())).status).toBe(201);
    expect((await up(as.PM, A, 'fake.png', SAMPLE_FILES.pdf())).status).toBe(415);
  });

  it('files over the size limit get 413; an empty file or a missing name gets 422', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(config.storage.fileMaxBytes + 1, 0x20)]);
    expect((await up(as.PM, A, 'big.pdf', big)).status).toBe(413);
    expect((await up(as.PM, A, 'empty.pdf', Buffer.alloc(0))).status).toBe(422);
    expect((await up(as.PM, A, '', SAMPLE_FILES.pdf())).status).toBe(422);
    expect((await up(as.PM, A, '../evil.pdf', SAMPLE_FILES.pdf())).status).toBe(422);
  });

  it('BR-FILE-03: an upload over the workspace quota gets 413 "Storage limit reached"', async () => {
    const before = await usage();
    await db.workspace.update({ where: { id: W.workspace.id }, data: { storage_used_bytes: BigInt(config.storage.quotaBytes - 10) } });
    try {
      const res = await up(as.PM, A, 'quota.pdf', SAMPLE_FILES.pdf());
      expect(res.status).toBe(413);
      expect(res.body.message).toBe('Storage limit reached');
    } finally {
      await db.workspace.update({ where: { id: W.workspace.id }, data: { storage_used_bytes: BigInt(before) } });
    }
  });

  it('BR-FILE-02: an infected upload is rejected, its bytes are released and the uploader is notified', async () => {
    const before = await usage();
    const res = await up(as.TeamMember, A, 'eicar.txt', Buffer.from(EICAR));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/virus/i);
    expect(await usage()).toBe(before);
    const v = await db.fileVersion.findFirst({ where: { original_name: 'eicar.txt', file: { project_id: A.id } } });
    expect(v).toMatchObject({ scan_status: 'Infected' });
    expect(v.deleted_at).not.toBeNull();
    expect(await db.notification.count({ where: { user_id: W.users.member.id, type: 'file_infected', channel: 'InApp' } })).toBe(1);
    const [entry] = await auditEntries('file.infected', { entity_id: v.file_id });
    expect(entry.after.signature).toBeTruthy();
  });

  it('roles: a Team Member not on the project, Finance and a contact cannot upload; a Team Member cannot share with the client', async () => {
    expect((await up(as.TeamMember2, A, 'x.pdf', SAMPLE_FILES.pdf())).status).toBe(403);
    expect((await up(as.Finance, A, 'x.pdf', SAMPLE_FILES.pdf())).status).toBe(403);
    expect((await up(as.TeamMember, B, 'x.pdf', SAMPLE_FILES.pdf())).status).toBe(403);
    expect((await up(as.TeamMember, A, 'shared.pdf', SAMPLE_FILES.pdf(), '?visibility=Client')).status).toBe(403);
    expect((await up(as.PM, A, 'shared.pdf', SAMPLE_FILES.pdf(), '?visibility=Client')).body.visibility).toBe('Client');
  });

  it('archived projects are read-only for files', async () => {
    const p = await db.project.create({ data: { workspace_id: W.workspace.id, client_id: W.clients.nova.id, name: 'Archived files', name_normalized: 'archived files', code: `NOV-9${Math.floor(Math.random() * 90 + 10)}`, status: 'Completed', billing_type: 'Fixed', start_date: new Date('2026-10-01'), pm_user_id: W.users.pm.id, archived_at: new Date() } });
    await db.projectMember.create({ data: { workspace_id: W.workspace.id, project_id: p.id, user_id: W.users.pm.id, project_role: 'PM' } });
    expect((await up(as.PM, p, 'late.pdf', SAMPLE_FILES.pdf())).status).toBe(409);
  });
});

describe('versions, preview and download (FR-FILE-02/03/04)', () => {
  let file;
  beforeAll(async () => {
    file = (await up(as.TeamMember, A, `design-${Date.now()}.png`, SAMPLE_FILES.png())).body;
  });

  it('TC-FILE-004: uploading v2 supersedes a pending approval on v1; older versions stay listed', async () => {
    const v1 = await db.fileVersion.findFirst({ where: { file_id: file.id, version_no: 1 } });
    const approval = await db.approvalRequest.create({ data: { workspace_id: W.workspace.id, project_id: A.id, file_version_id: v1.id, requested_by: W.users.pm.id, status: 'Pending' } });
    const res = await as.TeamMember.upload(`/api/v1/files/${file.id}/versions`, SAMPLE_FILES.png(), { name: 'design v2.png' });
    expect(res.status).toBe(201);
    expect(res.body.version_count).toBe(2);
    expect(res.body.versions.map((v) => v.version_no)).toEqual([2, 1]);
    expect((await db.approvalRequest.findUnique({ where: { id: approval.id } })).status).toBe('Superseded');
  });

  it('FR-FILE-04: a member gets a 10-minute signed link that downloads the file; images can be shown inline', async () => {
    const res = await as.PM.get(`/api/v1/files/${file.id}/versions/1/url?inline=true`);
    expect(res.status).toBe(200);
    expect(res.body.inline).toBe(true);
    expect(new Date(res.body.expires_at).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const got = await fetch(res.body.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(SAMPLE_FILES.png())).toBe(true);
    expect(got.headers.get('content-disposition')).toMatch(/^inline/);
  });

  it('TC-FILE-003: a link used after 11 minutes is refused', async () => {
    const v = await db.fileVersion.findFirst({ where: { file_id: file.id, version_no: 1 } });
    const { url } = await getFileUrl(v.storage_key, { filename: 'x.png', signingDate: new Date(Date.now() - 11 * 60_000) });
    expect((await fetch(url)).status).toBe(403);
  });

  it('D-30: a version still being scanned cannot be downloaded (409)', async () => {
    const pending = (await up(as.PM, A, `pending-${Date.now()}.pdf`, SAMPLE_FILES.pdf())).body;
    await db.fileVersion.updateMany({ where: { file_id: pending.id }, data: { scan_status: 'Pending' } });
    const res = await as.PM.get(`/api/v1/files/${pending.id}/versions/1/url`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/scanned/);
  });

  it('D-34 (c): SVG files are never served inline', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');
    const f = (await up(as.PM, A, `icon-${Date.now()}.svg`, svg)).body;
    expect(f.latest).toMatchObject({ mime_type: 'image/svg+xml', previewable: false });
    const res = await as.PM.get(`/api/v1/files/${f.id}/versions/1/url?inline=true`);
    expect(res.body.inline).toBe(false);
    expect(res.body.url).toContain(encodeURIComponent('attachment'));
  });

  it('who can read: Finance yes; a non-member Team Member 403; a contact 404 on an Internal file; another workspace 404', async () => {
    expect((await as.Finance.get(`/api/v1/files/${file.id}`)).status).toBe(200);
    expect((await as.TeamMember2.get(`/api/v1/files/${file.id}`)).status).toBe(403);
    expect((await as.TeamMember2.get(`/api/v1/files/${file.id}/versions/1/url`)).status).toBe(403);
    expect((await as.Contact.get(`/api/v1/files/${file.id}`)).status).toBe(404);
    const other = await createWorld('Files other');
    const stranger = await other.login(app, 'owner');
    expect((await stranger.get(`/api/v1/files/${file.id}`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/projects/${A.id}/files`)).status).toBe(404);
  });
});

describe('edit, folders and delete (FR-FILE-05/06/07)', () => {
  it('FR-FILE-07: only PM/Admin/Owner change visibility; a Team Member gets 403 and nothing changes', async () => {
    const f = (await up(as.TeamMember, A, `vis-${Date.now()}.pdf`, SAMPLE_FILES.pdf())).body;
    const denied = await as.TeamMember.patch(`/api/v1/files/${f.id}`, { visibility: 'Client', version: f.version });
    expect(denied.status).toBe(403);
    expect(denied.body.fields).toEqual([{ field: 'visibility', message: expect.any(String) }]);
    expect((await db.file.findUnique({ where: { id: f.id } })).visibility).toBe('Internal');
    const ok = await as.PM.patch(`/api/v1/files/${f.id}`, { visibility: 'Client', version: f.version });
    expect(ok.status).toBe(200);
    expect(ok.body.visibility).toBe('Client');
    expect((await as.PM.patch(`/api/v1/files/${f.id}`, { name: 'stale.pdf', version: f.version })).status).toBe(409);
    expect((await as.PM.patch(`/api/v1/files/${f.id}`, { project_id: B.id, version: ok.body.version })).status).toBe(422);
    const [entry] = await auditEntries('file.visibility_changed', { entity_id: f.id });
    expect(entry).toMatchObject({ before: { visibility: 'Internal' }, after: { visibility: 'Client' } });
  });

  it('FR-FILE-05: one level of folders; names unique per project; deleting a folder moves its files to the root', async () => {
    const folder = await as.PM.post(`/api/v1/projects/${A.id}/folders`, { name: 'Designs' });
    expect(folder.status).toBe(201);
    expect((await as.PM.post(`/api/v1/projects/${A.id}/folders`, { name: 'designs' })).status).toBe(409);
    expect((await as.TeamMember.post(`/api/v1/projects/${A.id}/folders`, { name: 'Mine' })).status).toBe(403);
    const f = (await up(as.TeamMember, A, `in-folder-${Date.now()}.pdf`, SAMPLE_FILES.pdf(), `?folder_id=${folder.body.id}`)).body;
    expect(f.folder).toEqual({ id: folder.body.id, name: 'Designs' });
    const inFolder = await as.TeamMember.get(`/api/v1/projects/${A.id}/files?folder=${folder.body.id}`);
    expect(inFolder.body.data.map((x) => x.id)).toEqual([f.id]);
    expect((await as.PM.delete(`/api/v1/projects/${A.id}/folders/${folder.body.id}`)).status).toBe(204);
    expect((await db.file.findUnique({ where: { id: f.id } })).folder_id).toBeNull();
  });

  it('FR-FILE-06: the uploader, the PM and Admin delete; others get 403; a decided approval blocks deletion', async () => {
    const mine = (await up(as.TeamMember, A, `mine-${Date.now()}.pdf`, SAMPLE_FILES.pdf())).body;
    const pms = (await up(as.PM, A, `pms-${Date.now()}.pdf`, SAMPLE_FILES.pdf())).body;
    expect((await as.TeamMember.delete(`/api/v1/files/${pms.id}`)).status).toBe(403);
    expect((await as.Finance.delete(`/api/v1/files/${pms.id}`)).status).toBe(403);
    expect((await as.TeamMember.delete(`/api/v1/files/${mine.id}`)).status).toBe(204);
    expect((await as.PM.get(`/api/v1/files/${mine.id}`)).status).toBe(404); // soft-deleted
    const v = await db.fileVersion.findFirst({ where: { file_id: pms.id } });
    await db.approvalRequest.create({ data: { workspace_id: W.workspace.id, project_id: A.id, file_version_id: v.id, requested_by: W.users.pm.id, status: 'Approved' } });
    const blocked = await as.Admin.delete(`/api/v1/files/${pms.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/decided approval/);
  });

  it('files deleted more than 30 days ago are purged: rows, stored object and quota', async () => {
    const f = (await up(as.PM, A, `old-${Date.now()}.pdf`, SAMPLE_FILES.pdf())).body;
    const v = await db.fileVersion.findFirst({ where: { file_id: f.id } });
    const { url } = await getFileUrl(v.storage_key);
    expect((await fetch(url)).status).toBe(200);
    const before = await usage();
    await db.file.update({ where: { id: f.id }, data: { deleted_at: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await purgeDeletedFiles()).toBeGreaterThanOrEqual(1);
    expect(await db.file.findUnique({ where: { id: f.id } })).toBeNull();
    expect(await usage()).toBe(before - Number(v.size_bytes));
    expect((await fetch(url)).status).toBe(404);
  });
});
