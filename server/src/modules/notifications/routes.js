// FR-NOT-01 (bell), FR-NOT-03 (preferences), FR-NOT-05 (follow / unfollow).
// Everything here is the signed-in person's own data; nobody reads anyone else's.
import { followSchema, notificationListQuerySchema, notificationPrefsSchema } from '@cpm/shared';
import { Router } from 'express';
import { can } from '../../auth/can.js';
import { authorize } from '../../auth/authorize.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { effectivePrefs, follow } from '../../lib/notify.js';

import { isUuid, validateBody, validateQuery } from '../../lib/validate.js';
import { loadFileContext } from '../files/common.js';
import { loadProjectContext } from '../projects/common.js';
import { loadTaskContext } from '../tasks/common.js';

const mine = (principal) => (principal.kind === 'user' ? { user_id: principal.id } : { contact_id: principal.id });
const inApp = (principal) => ({ ...mine(principal), channel: 'InApp' });

const toDto = (n) => ({ id: n.id, type: n.type, entity_type: n.entity_type, entity_id: n.entity_id, title: n.payload?.title ?? '', text: n.payload?.text ?? null, link: n.payload?.link ?? null, read: Boolean(n.read_at), created_at: n.created_at });

export const notificationsRouter = Router();
const signedIn = authorize('self.internalApp'); // contacts get the same in the portal (Phase 5)

notificationsRouter.get('/notifications', signedIn, validateQuery(notificationListQuerySchema), async (req, res) => {
  const q = req.validQuery;
  const where = { ...inApp(req.principal), ...(q.unread ? { read_at: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...inApp(req.principal), read_at: null } }),
  ]);
  res.json({ data: rows.map(toDto), page: q.page, page_size: q.page_size, total, unread });
});

notificationsRouter.get('/notifications/unread-count', signedIn, async (req, res) => {
  res.json({ unread: await db.notification.count({ where: { ...inApp(req.principal), read_at: null } }) });
});

notificationsRouter.post('/notifications/read-all', signedIn, async (req, res) => {
  const r = await db.notification.updateMany({ where: { ...inApp(req.principal), read_at: null }, data: { read_at: new Date() } });
  res.json({ marked: r.count });
});

notificationsRouter.post('/notifications/:id/read', signedIn, async (req, res) => {
  const id = req.params.id;
  // Someone else's notification answers 404, the same as a missing one
  const r = isUuid(id) ? await db.notification.updateMany({ where: { id, ...inApp(req.principal) }, data: { read_at: new Date() } }) : { count: 0 };
  if (!r.count) {
    const exists = isUuid(id) ? await db.notification.findFirst({ where: { id, ...inApp(req.principal) } }) : null;
    if (!exists) throw notFound('Notification not found');
  }
  res.status(204).end();
});

notificationsRouter.get('/notification-preferences', signedIn, async (req, res) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: req.principal.id }, select: { notification_prefs: true } });
  res.json({ preferences: effectivePrefs(u.notification_prefs) });
});

notificationsRouter.put('/notification-preferences', signedIn, validateBody(notificationPrefsSchema), async (req, res) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: req.principal.id }, select: { notification_prefs: true } });
  // D-35: store only what the person chose, so events they never touched follow the defaults
  const chosen = { ...(u.notification_prefs ?? {}), ...req.body };
  const before = effectivePrefs(u.notification_prefs);
  await db.user.update({ where: { id: req.principal.id }, data: { notification_prefs: chosen, updated_by: req.principal.id } });
  const after = effectivePrefs(chosen);
  await writeAudit({ req, action: 'user.notification_prefs_changed', entityType: 'User', entityId: req.principal.id, before, after });
  res.json({ preferences: after });
});

// ---------------------------------------------------------------------------
// Follow / unfollow (FR-NOT-05): only records the person can read
// ---------------------------------------------------------------------------

async function readable(req, { entity_type: type, entity_id: id }) {
  const ctx = type === 'Task' ? await loadTaskContext(req, id) : type === 'File' ? await loadFileContext(req, id) : await loadProjectContext(req, id);
  const action = type === 'Task' ? 'task.read' : type === 'File' ? 'file.read' : 'project.read';
  if (!can(req.principal, action, ctx)) throw notFound();
  return ctx;
}

export const followsRouter = Router();

followsRouter.get('/', signedIn, validateQuery(followSchema), async (req, res) => {
  await readable(req, req.validQuery);
  const f = await db.follower.findFirst({ where: { entity_type: req.validQuery.entity_type, entity_id: req.validQuery.entity_id, ...mine(req.principal) } });
  res.json({ following: Boolean(f) });
});
followsRouter.post('/', signedIn, validateBody(followSchema), async (req, res) => {
  await readable(req, req.body);
  await follow(db, { workspaceId: req.principal.workspace_id, entityType: req.body.entity_type, entityId: req.body.entity_id, userIds: [req.principal.id], actorId: req.principal.id });
  res.json({ following: true });
});
followsRouter.delete('/', signedIn, validateQuery(followSchema), async (req, res) => {
  // Anyone can unfollow (FR-NOT-05), even after losing access to the record
  await db.follower.deleteMany({ where: { entity_type: req.validQuery.entity_type, entity_id: req.validQuery.entity_id, ...mine(req.principal) } });
  res.json({ following: false });
});
