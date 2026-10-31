// /api/v1/comments — every route goes through authorize() on the commented record.
import { commentCreateSchema, commentListQuerySchema, commentUpdateSchema } from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { validateBody, validateQuery } from '../../lib/validate.js';
import * as service from './service.js';

// Contacts who cannot read the record get 404, so its existence is not revealed (BR-CLI-01)
const fromQuery = { load: (req) => service.loadTarget(req, req.validQuery), readAction: 'comment.read' };
const fromBody = { load: (req) => service.loadTarget(req, req.body), readAction: 'comment.read' };
const comment = { load: (req) => service.loadCommentContext(req), readAction: 'comment.read' };

export const commentsRouter = Router();

commentsRouter.get('/', validateQuery(commentListQuerySchema), authorize('comment.read', fromQuery), async (req, res) => {
  res.json(await service.listComments(req.principal, req.ctx, req.validQuery));
});
commentsRouter.get('/mentionable', validateQuery(commentListQuerySchema.pick({ entity_type: true, entity_id: true })), authorize('comment.create', fromQuery), async (req, res) => {
  res.json(await service.mentionable(req.ctx));
});
commentsRouter.post('/', validateBody(commentCreateSchema), authorize('comment.create', fromBody), async (req, res) => {
  res.status(201).json(await service.createComment(req.principal, req.ctx, req.body, req));
});
commentsRouter.patch('/:commentId', authorize('comment.update', comment), validateBody(commentUpdateSchema), async (req, res) => {
  res.json(await service.updateComment(req.principal, req.ctx, req.body, req));
});
commentsRouter.delete('/:commentId', authorize('comment.delete', comment), async (req, res) => {
  await service.deleteComment(req.principal, req.ctx, req);
  res.status(204).end();
});
