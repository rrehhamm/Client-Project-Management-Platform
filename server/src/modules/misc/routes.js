// Small Phase 4 routes: dashboard (FR-DASH), search (FR-SRCH-01), storage use
// (BR-FILE-03) and avatars (FR-AUTH-13).
import { randomUUID } from 'node:crypto';
import { searchQuerySchema } from '@cpm/shared';
import express, { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { authorize } from '../../auth/authorize.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { deleteObject, getFileUrl, putObject } from '../../lib/storage.js';
import { isUuid, validateQuery } from '../../lib/validate.js';
import { dashboard } from '../dashboard/service.js';
import { storageUsage } from '../files/service.js';
import { search } from '../search/service.js';

export const dashboardRouter = Router();
dashboardRouter.get('/', authorize('self.internalApp'), async (req, res) => {
  res.json(await dashboard(req.principal));
});

export const searchRouter = Router();
searchRouter.get('/', authorize('self.internalApp'), validateQuery(searchQuerySchema), async (req, res) => {
  res.json(await search(req.principal, req.validQuery.q));
});

export const storageRouter = Router();
storageRouter.get('/', authorize('workspace.update'), async (req, res) => {
  res.json(await storageUsage(req.principal.workspace_id));
});

// ---------------------------------------------------------------------------
// Avatars (FR-AUTH-13): PNG, JPEG or WebP up to 2 MB, checked by content
// ---------------------------------------------------------------------------

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const avatarRouter = Router();

avatarRouter.put('/avatar', authorize('self.internalApp'), express.raw({ type: () => true, limit: AVATAR_MAX_BYTES }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const type = (await fileTypeFromBuffer(body))?.mime;
  if (!AVATAR_TYPES.includes(type)) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use a PNG, JPEG or WebP image', [{ field: 'avatar', message: 'Use a PNG, JPEG or WebP image' }]);
  const user = await db.user.findUniqueOrThrow({ where: { id: req.principal.id }, select: { avatar_key: true } });
  const key = `ws/${req.principal.workspace_id}/avatars/${req.principal.id}/${randomUUID()}`;
  await putObject(key, body, type);
  await db.user.update({ where: { id: req.principal.id }, data: { avatar_key: key, version: { increment: 1 }, updated_by: req.principal.id } });
  await writeAudit({ req, action: 'user.avatar_updated', entityType: 'User', entityId: req.principal.id, after: { type, bytes: body.length } });
  if (user.avatar_key) await deleteObject(user.avatar_key).catch(() => {});
  res.json({ has_avatar: true });
});

avatarRouter.delete('/avatar', authorize('self.internalApp'), async (req, res) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: req.principal.id }, select: { avatar_key: true } });
  if (user.avatar_key) {
    await db.user.update({ where: { id: req.principal.id }, data: { avatar_key: null, version: { increment: 1 }, updated_by: req.principal.id } });
    await writeAudit({ req, action: 'user.avatar_removed', entityType: 'User', entityId: req.principal.id });
    await deleteObject(user.avatar_key).catch(() => {});
  }
  res.json({ has_avatar: false });
});

/** Any signed-in internal user may see colleagues' avatars: a redirect to a short-lived link. */
export const avatarsRouter = Router();
avatarsRouter.get('/:userId', authorize('self.internalApp'), async (req, res) => {
  const u = isUuid(req.params.userId) ? await db.user.findFirst({ where: { id: req.params.userId, workspace_id: req.principal.workspace_id }, select: { avatar_key: true } }) : null;
  if (!u?.avatar_key) throw notFound('No avatar');
  const { url } = await getFileUrl(u.avatar_key, { inline: true });
  res.set('Cache-Control', 'private, max-age=300');
  res.redirect(302, url);
});
