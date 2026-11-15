// /api/v1/approvals — internal side of approvals (FR-APP-01/02/05/06). Contacts decide
// through /api/v1/portal (D-40); internal users never decide (BR-APP-02).
import { approvalCreateSchema, approvalListQuerySchema, pinCreateSchema } from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { validateBody, validateQuery } from '../../lib/validate.js';
import * as service from './service.js';

const approval = { load: (req) => service.loadApprovalContext(req), readAction: 'approval.read' };

export const approvalsRouter = Router();

approvalsRouter.get('/', authorize('self.internalApp'), validateQuery(approvalListQuerySchema), async (req, res) => {
  res.json(await service.listApprovals(req.principal, req.validQuery));
});
// The permission is checked in the service, on the project of the chosen file or task
approvalsRouter.post('/', authorize('self.internalApp'), validateBody(approvalCreateSchema), async (req, res) => {
  res.status(201).json(await service.requestApproval(req.principal, req.body, req));
});
approvalsRouter.get('/:approvalId', authorize('approval.read', approval), async (req, res) => {
  res.json(service.toApprovalDto(req.ctx.approval, req.principal, req.ctx));
});
approvalsRouter.post('/:approvalId/cancel', authorize('approval.cancel', approval), async (req, res) => {
  await service.cancelApproval(req.principal, req.ctx, req);
  const fresh = await service.loadApprovalContext(req);
  res.json(service.toApprovalDto(fresh.approval, req.principal, fresh));
});
approvalsRouter.post('/:approvalId/pins', authorize('approval.pin', approval), validateBody(pinCreateSchema), async (req, res) => {
  res.status(201).json(await service.addPin(req.principal, req.ctx.approval, req.body, req));
});
approvalsRouter.get('/:approvalId/proof-url', authorize('approval.read', approval), async (req, res) => {
  res.json(await service.proofUrl(req.ctx.approval, req));
});
