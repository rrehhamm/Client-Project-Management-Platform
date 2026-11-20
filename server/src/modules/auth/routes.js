// /api/v1/auth — sign-in, sessions, invitations, passwords, own profile.
// Public routes have no principal to authorize; they are rate limited per IP.
import {
  acceptInviteSchema,
  appearanceSchema,
  changePasswordSchema,
  emailChangeSchema,
  forgotPasswordSchema,
  linkTokenSchema,
  loginSchema,
  profileUpdateSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@cpm/shared';
import { Router } from 'express';
import { requireAuth } from '../../auth/authenticate.js';
import { csrfTokenHandler } from '../../auth/csrf.js';
import { linkExpired } from '../../auth/linkTokens.js';
import { validateBody } from '../../lib/validate.js';
import * as controller from './controller.js';

export function createAuthRouter({ authLimiter }) {
  const router = Router();

  router.get('/csrf', csrfTokenHandler);

  router.post('/login', authLimiter, validateBody(loginSchema), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);

  router.get('/me', requireAuth, controller.me);
  router.patch('/me', requireAuth, validateBody(profileUpdateSchema), controller.updateProfile);
  router.put('/me/appearance', requireAuth, validateBody(appearanceSchema), controller.updateAppearance); // D-45
  router.post('/me/email-change', requireAuth, validateBody(emailChangeSchema), controller.requestEmailChange);
  router.post('/email/verify', authLimiter, validateBody(verifyEmailSchema), controller.verifyEmail);

  router.get(
    '/invitations/:token',
    authLimiter,
    (req, _res, next) => next(linkTokenSchema.safeParse(req.params.token).success ? undefined : linkExpired('Invite')),
    controller.getInvitation,
  );
  router.post('/invitations/accept', authLimiter, validateBody(acceptInviteSchema), controller.acceptInvitation);

  router.post('/password/forgot', authLimiter, validateBody(forgotPasswordSchema), controller.forgotPassword);
  router.post('/password/reset', authLimiter, validateBody(resetPasswordSchema), controller.resetPassword);
  router.post('/password/change', requireAuth, validateBody(changePasswordSchema), controller.changePassword);

  return router;
}
