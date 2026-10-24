import * as service from './service.js';

export async function list(req, res) {
  res.json(await service.listUsers(req.principal, req.validQuery));
}

export function get(req, res) {
  res.json(service.toUserDto(req.ctx.target, req.principal));
}

export async function invite(req, res) {
  res.status(201).json(await service.inviteUser(req.principal, req.body, req));
}

export async function resendInvitation(req, res) {
  res.json(await service.resendInvitation(req.principal, req.ctx.target, req));
}

export async function revokeInvitation(req, res) {
  await service.revokeInvitation(req.principal, req.ctx.target, req);
  res.status(204).end();
}

export async function update(req, res) {
  res.json(await service.updateUser(req.principal, req.ctx.target, req.body, req));
}

export async function deactivate(req, res) {
  res.json(await service.deactivateUser(req.principal, req.ctx.target, req));
}

export async function reactivate(req, res) {
  res.json(await service.reactivateUser(req.principal, req.ctx.target, req));
}

export async function transferOwnership(req, res) {
  res.json(await service.transferOwnership(req.principal, req.ctx.target, req.body, req));
}
