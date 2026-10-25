// /api/v1/workspace — FR-WS-01, D-17.
import { LOGO_MAX_BYTES, LOGO_TYPES, workspaceUpdateSchema } from '@cpm/shared';
import express, { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { validateBody } from '../../lib/validate.js';
import * as service from './service.js';

export const workspaceRouter = Router();

workspaceRouter.get('/', authorize('workspace.read'), async (req, res) => {
  res.json(await service.getWorkspaceFor(req.principal));
});

workspaceRouter.patch('/', authorize('workspace.update'), validateBody(workspaceUpdateSchema), async (req, res) => {
  res.json(await service.updateWorkspace(req.principal, req.body, req));
});

workspaceRouter.put(
  '/logo',
  authorize('workspace.update'),
  // Raw body for the accepted image types only; anything else arrives empty and is refused.
  express.raw({ type: LOGO_TYPES, limit: LOGO_MAX_BYTES }),
  async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const declaredType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    res.json(await service.uploadLogo(req.principal, { body, declaredType }, req));
  },
);

workspaceRouter.delete('/logo', authorize('workspace.update'), async (req, res) => {
  res.json(await service.removeLogo(req.principal, req));
});
