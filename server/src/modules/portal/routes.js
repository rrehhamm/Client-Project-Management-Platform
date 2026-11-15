// /api/v1/portal — the only API Client Contacts can use besides /auth (D-40).
// Read checks answer 404 outside the contact's scope (BR-CLI-01); action checks
// answer 403 when they can see the item but their portal level is too low (TC-PORT-004).
import {
  approvalDecisionSchema,
  approvalListQuerySchema,
  clientRequestSchema,
  commentCreateSchema,
  commentListQuerySchema,
  commentUpdateSchema,
  contactNotificationPrefsSchema,
  downloadQuerySchema,
  notificationListQuerySchema,
  pinCreateSchema,
  portalListQuerySchema,
} from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { config } from '../../config.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { effectiveContactPrefs } from '../../lib/notify.js';
import { isUuid, validateBody, validateQuery } from '../../lib/validate.js';
import * as approvals from '../approvals/service.js';
import * as comments from '../comments/service.js';
import { loadFileContext } from '../files/common.js';
import * as files from '../files/service.js';
import { loadProjectContext } from '../projects/common.js';
import { loadTaskContext } from '../tasks/common.js';
import { portalCommentDto } from './dto.js';
import * as portal from './service.js';
import { portalCtx, requirePortal } from './scope.js';

export const portalRouter = Router();
portalRouter.use(authorize('self.portal')); // contacts only; internal users get 403 here

const projectCtx = (req) => portalCtx(req, (r) => loadProjectContext(r, r.params.id), 'project.read');

portalRouter.get('/branding', async (req, res) => res.json(await portal.branding(req.principal)));
portalRouter.get('/home', async (req, res) => res.json(await portal.home(req.principal)));
portalRouter.get('/projects', async (req, res) => res.json(await portal.listProjects(req.principal)));

portalRouter.get('/projects/:id', async (req, res) => {
  res.json(await portal.projectDetail(await projectCtx(req)));
});
portalRouter.get('/projects/:id/tasks', validateQuery(portalListQuerySchema), async (req, res) => {
  res.json(await portal.listTasks(await projectCtx(req), req.validQuery));
});
portalRouter.get('/tasks/:taskId', async (req, res) => {
  res.json(await portal.taskDetail(await portalCtx(req, (r) => loadTaskContext(r), 'task.read')));
});

// FR-PORT-03: Comment-level contacts send requests
portalRouter.post('/projects/:id/requests', validateBody(clientRequestSchema), async (req, res) => {
  const ctx = await projectCtx(req);
  await requirePortal(req, 'task.request', ctx);
  res.status(201).json(await portal.createRequest(req.principal, ctx, req.body, req));
});

// ---------------------------------------------------------------------------
// Files (FR-PORT-02/04): Client files only; contacts' uploads are Client (D-44 b)
// ---------------------------------------------------------------------------

portalRouter.get('/projects/:id/files', validateQuery(portalListQuerySchema), async (req, res) => {
  res.json(await portal.listFiles(await projectCtx(req), req.validQuery));
});
portalRouter.post('/projects/:id/files', async (req, res) => {
  const ctx = await projectCtx(req);
  try {
    await requirePortal(req, 'file.create', ctx);
    const created = await files.uploadFile(req.principal, ctx, { task_id: isUuid(req.query.task_id) ? req.query.task_id : undefined }, req);
    res.status(201).json(await portal.fileDetail(created.id));
  } catch (err) {
    // Let the browser read the error instead of a reset connection (as in files/routes.js)
    if (!req.readableEnded && (Number(req.get('content-length')) || 0) <= config.storage.fileMaxBytes * 1.1) {
      req.resume();
      await new Promise((r) => {
        req.once('end', r);
        req.once('close', r);
      });
    }
    throw err;
  }
});
const fileCtx = (req) => portalCtx(req, (r) => loadFileContext(r), 'file.read');
portalRouter.get('/files/:fileId', async (req, res) => {
  const ctx = await fileCtx(req);
  res.json(await portal.fileDetail(ctx.file.id));
});
portalRouter.get('/files/:fileId/versions/:versionNo/url', validateQuery(downloadQuerySchema), async (req, res) => {
  const ctx = await fileCtx(req);
  res.json(await files.downloadUrl(req.principal, ctx, req.params.versionNo, req.validQuery, req));
});

// ---------------------------------------------------------------------------
// Comments (FR-PORT-04): Client comments only (BR-COM-01); theirs are always Client
// ---------------------------------------------------------------------------

portalRouter.get('/comments', validateQuery(commentListQuerySchema), async (req, res) => {
  const ctx = await portalCtx(req, (r) => comments.loadTarget(r, r.validQuery), 'comment.read');
  const page = await comments.listComments(req.principal, ctx, req.validQuery);
  res.json({ ...page, data: page.data.map(portalCommentDto) });
});
portalRouter.post('/comments', validateBody(commentCreateSchema.omit({ mention_user_ids: true, mention_contact_ids: true, visibility: true })), async (req, res) => {
  const ctx = await portalCtx(req, (r) => comments.loadTarget(r, r.body), 'comment.read');
  await requirePortal(req, 'comment.create', ctx);
  res.status(201).json(portalCommentDto(await comments.createComment(req.principal, ctx, req.body, req)));
});
const commentCtx = (req) => portalCtx(req, (r) => comments.loadCommentContext(r), 'comment.read');
portalRouter.patch('/comments/:commentId', validateBody(commentUpdateSchema.omit({ mention_user_ids: true })), async (req, res) => {
  const ctx = await commentCtx(req);
  await requirePortal(req, 'comment.update', ctx);
  res.json(portalCommentDto(await comments.updateComment(req.principal, ctx, req.body, req)));
});
portalRouter.delete('/comments/:commentId', async (req, res) => {
  const ctx = await commentCtx(req);
  await requirePortal(req, 'comment.delete', ctx);
  await comments.deleteComment(req.principal, ctx, req);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Approvals (FR-PORT-05, FR-APP-02/03, BR-APP-02)
// ---------------------------------------------------------------------------

const approvalCtx = (req) => portalCtx(req, portal.loadPortalApproval, 'approval.read');

portalRouter.get('/approvals', validateQuery(approvalListQuerySchema.pick({ page: true, page_size: true, status: true })), async (req, res) => {
  res.json(await portal.listApprovals(req.principal, req.validQuery));
});
portalRouter.get('/approvals/:approvalId', async (req, res) => {
  const ctx = await approvalCtx(req);
  res.json(approvals.toPortalApprovalDto(ctx.approval, req.principal));
});
portalRouter.get('/approvals/:approvalId/proof-url', async (req, res) => {
  const ctx = await approvalCtx(req);
  res.json(await approvals.proofUrl(ctx.approval, req));
});
portalRouter.post('/approvals/:approvalId/decision', validateBody(approvalDecisionSchema), async (req, res) => {
  const ctx = await approvalCtx(req);
  await requirePortal(req, 'approval.decide', ctx); // TC-APP-002: not an Approve-level approver → 403
  await approvals.decide(req.principal, ctx.approval, req.body, req);
  const fresh = await approvalCtx(req);
  res.json(approvals.toPortalApprovalDto(fresh.approval, req.principal));
});
// BR-APP-01: decisions are final; there is nothing to change (TC-APP-003)
portalRouter.patch('/approvals/:approvalId/decision', async (req, res) => {
  const ctx = await approvalCtx(req);
  await requirePortal(req, 'approval.decide', ctx);
  res.status(409).json({ code: 'CONFLICT', message: 'A decision cannot be changed. Ask the team to send a new version for approval.', fields: [] });
});
portalRouter.post('/approvals/:approvalId/pins', validateBody(pinCreateSchema), async (req, res) => {
  const ctx = await approvalCtx(req);
  await requirePortal(req, 'approval.pin', ctx);
  res.status(201).json(await approvals.addPin(req.principal, ctx.approval, req.body, req));
});

// ---------------------------------------------------------------------------
// Notifications for contacts (FR-NOT-01/03)
// ---------------------------------------------------------------------------

const mine = (req) => ({ contact_id: req.principal.id, channel: 'InApp' });
const notificationDto = (n) => ({ id: n.id, type: n.type, title: n.payload?.title ?? '', text: n.payload?.text ?? null, link: n.payload?.link ?? null, read: Boolean(n.read_at), created_at: n.created_at });

portalRouter.get('/notifications', validateQuery(notificationListQuerySchema), async (req, res) => {
  const q = req.validQuery;
  const where = { ...mine(req), ...(q.unread ? { read_at: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...mine(req), read_at: null } }),
  ]);
  res.json({ data: rows.map(notificationDto), page: q.page, page_size: q.page_size, total, unread });
});
portalRouter.get('/notifications/unread-count', async (req, res) => {
  res.json({ unread: await db.notification.count({ where: { ...mine(req), read_at: null } }) });
});
portalRouter.post('/notifications/read-all', async (req, res) => {
  res.json({ marked: (await db.notification.updateMany({ where: { ...mine(req), read_at: null }, data: { read_at: new Date() } })).count });
});
portalRouter.post('/notifications/:id/read', async (req, res) => {
  const id = req.params.id;
  const n = isUuid(id) ? await db.notification.findFirst({ where: { id, ...mine(req) } }) : null;
  if (!n) throw notFound('Notification not found');
  if (!n.read_at) await db.notification.update({ where: { id }, data: { read_at: new Date() } });
  res.status(204).end();
});
portalRouter.get('/notification-preferences', async (req, res) => {
  const c = await db.clientContact.findUniqueOrThrow({ where: { id: req.principal.id }, select: { notification_prefs: true } });
  res.json({ preferences: effectiveContactPrefs(c.notification_prefs) });
});
portalRouter.put('/notification-preferences', validateBody(contactNotificationPrefsSchema), async (req, res) => {
  const c = await db.clientContact.findUniqueOrThrow({ where: { id: req.principal.id }, select: { notification_prefs: true } });
  const chosen = { ...(c.notification_prefs ?? {}), ...req.body }; // D-35: only what they chose
  await db.clientContact.update({ where: { id: req.principal.id }, data: { notification_prefs: chosen, updated_by: req.principal.id } });
  const after = effectiveContactPrefs(chosen);
  await writeAudit({ req, action: 'contact.notification_prefs_changed', entityType: 'ClientContact', entityId: req.principal.id, before: effectiveContactPrefs(c.notification_prefs), after });
  res.json({ preferences: after });
});
