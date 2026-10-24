// /api/v1/users — internal user management. Every route goes through authorize().
import { inviteUserSchema, transferOwnershipSchema, userListQuerySchema, userUpdateSchema } from '@cpm/shared';
import { Router } from 'express';
import { authorize, authorizeFields } from '../../auth/authorize.js';
import { notFound } from '../../lib/errors.js';
import { isUuid, validateBody, validateQuery } from '../../lib/validate.js';
import * as controller from './controller.js';
import { findUserInWorkspace } from './service.js';

/** Which permission each PATCH field needs (rule 3). */
export const USER_FIELD_ACTIONS = Object.freeze({
  full_name: 'user.update',
  capacity_minutes_per_week: 'user.update',
  role: 'user.changeRole',
  hourly_cost_rate: 'user.updateRates',
  default_bill_rate: 'user.updateRates',
  version: null,
});

async function loadTarget(req) {
  const target = isUuid(req.params.id) ? await findUserInWorkspace(req.principal.workspace_id, req.params.id) : null;
  if (!target) throw notFound('User not found');
  return { target };
}

export const usersRouter = Router();

usersRouter.get('/', authorize('user.list'), validateQuery(userListQuerySchema), controller.list);
usersRouter.post(
  '/',
  // Authorize first (with the requested role as given), so a role without invite
  // rights gets 403 even for a malformed body; then validate.
  authorize('user.invite', { load: async (req) => ({ target: { role: req.body?.role } }) }),
  validateBody(inviteUserSchema),
  controller.invite,
);
usersRouter.get('/:id', authorize('user.read', { load: loadTarget }), controller.get);
usersRouter.patch(
  '/:id',
  authorize('user.read', { load: loadTarget }),
  authorizeFields(USER_FIELD_ACTIONS),
  validateBody(userUpdateSchema),
  controller.update,
);
usersRouter.post('/:id/invitation/resend', authorize('user.manageInvitation', { load: loadTarget }), controller.resendInvitation);
usersRouter.delete('/:id/invitation', authorize('user.manageInvitation', { load: loadTarget }), controller.revokeInvitation);
usersRouter.post('/:id/deactivate', authorize('user.deactivate', { load: loadTarget }), controller.deactivate);
usersRouter.post('/:id/reactivate', authorize('user.deactivate', { load: loadTarget }), controller.reactivate);
usersRouter.post(
  '/:id/transfer-ownership',
  authorize('workspace.transferOwnership', { load: loadTarget }),
  validateBody(transferOwnershipSchema),
  controller.transferOwnership,
);
