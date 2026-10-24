import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../../auth/cookies.js';
import * as service from './service.js';

const sessionResponse = (res, session) => {
  setAuthCookies(res, session);
  res.json({ principal: session.principal, home: service.homeFor(session.principal) });
};

export async function login(req, res) {
  sessionResponse(res, await service.login(req.body, req));
}

export async function refresh(req, res) {
  try {
    sessionResponse(res, await service.refresh(req.cookies?.[REFRESH_COOKIE]));
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
}

export async function logout(req, res) {
  await service.logout(req, req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(204).end();
}

export async function me(req, res) {
  res.json(await service.getMe(req.principal));
}

export async function updateProfile(req, res) {
  res.json(await service.updateProfile(req.principal, req.body, req));
}

export async function requestEmailChange(req, res) {
  await service.requestEmailChange(req.principal, req.body, req);
  res.status(202).json({ message: 'Check your new email address for a confirmation link' });
}

export async function verifyEmail(req, res) {
  res.json(await service.verifyEmailChange(req.body, req));
}

export async function getInvitation(req, res) {
  res.json(await service.getInvitation(req.params.token));
}

export async function acceptInvitation(req, res) {
  sessionResponse(res, await service.acceptInvitation(req.body, req));
}

export async function forgotPassword(req, res) {
  await service.forgotPassword(req.body, req);
  res.json({ message: 'If the email exists, a link was sent' }); // FR-AUTH-08
}

export async function resetPassword(req, res) {
  await service.resetPassword(req.body, req);
  clearAuthCookies(res);
  res.json({ message: 'Your password was reset. Sign in with your new password.' });
}

export async function changePassword(req, res) {
  await service.changePassword(req.principal, req.body, req);
  res.json({ message: 'Password changed. Your other sessions were signed out.' });
}
