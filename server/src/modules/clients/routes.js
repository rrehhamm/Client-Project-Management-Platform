// /api/v1/clients and /api/v1/contacts — every route goes through authorize().
import {
  clientCreateSchema,
  clientListQuerySchema,
  clientUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  paginationSchema,
  prefixSuggestionQuerySchema,
} from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { activityScope } from '../../auth/scopes.js';
import { listActivity } from '../../lib/activityFeed.js';
import { db } from '../../lib/db.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { isUuid, validateBody, validateQuery } from '../../lib/validate.js';
import * as contacts from './contacts.js';
import * as service from './service.js';

/** ctx for client routes; Team Members also get memberOfClient (name-only access). */
async function loadClient(req) {
  const client = isUuid(req.params.id) ? await service.findClientInWorkspace(req.principal.workspace_id, req.params.id) : null;
  if (!client) throw notFound('Client not found');
  let memberOfClient = false;
  if (req.principal.kind === 'user') {
    memberOfClient =
      (await db.project.count({ where: { client_id: client.id, deleted_at: null, members: { some: { user_id: req.principal.id } } } })) > 0;
  }
  return { client, memberOfClient, record: client };
}

async function loadContact(req) {
  const contact = isUuid(req.params.contactId) ? await contacts.findContactInWorkspace(req.principal.workspace_id, req.params.contactId) : null;
  if (!contact) throw notFound('Contact not found');
  return { contact, client: contact.client, record: contact };
}

export const clientsRouter = Router();

clientsRouter.get('/', authorize('client.list'), validateQuery(clientListQuerySchema), async (req, res) => {
  res.json(await service.listClients(req.principal, req.validQuery));
});
clientsRouter.get('/prefix-suggestion', authorize('client.create'), validateQuery(prefixSuggestionQuerySchema), async (req, res) => {
  res.json(await service.suggestPrefixFor(req.principal, req.validQuery.name));
});
clientsRouter.post('/', authorize('client.create'), validateBody(clientCreateSchema), async (req, res) => {
  res.status(201).json(await service.createClient(req.principal, req.body, req));
});
clientsRouter.get('/:id', authorize('client.read', { load: loadClient }), async (req, res) => {
  res.json(await service.getClientDetail(req.principal, req.ctx.client));
});
clientsRouter.patch('/:id', authorize('client.update', { load: loadClient }), validateBody(clientUpdateSchema), async (req, res) => {
  res.json(await service.updateClient(req.principal, req.ctx.client, req.body, req));
});
clientsRouter.post('/:id/archive', authorize('client.update', { load: loadClient }), async (req, res) => {
  res.json(await service.archiveClient(req.principal, req.ctx.client, req));
});
clientsRouter.post('/:id/restore', authorize('client.update', { load: loadClient }), async (req, res) => {
  res.json(await service.restoreClient(req.principal, req.ctx.client, req));
});
clientsRouter.delete('/:id', authorize('client.delete', { load: loadClient }), async (req, res) => {
  await service.deleteClient(req.principal, req.ctx.client, req);
  res.status(204).end();
});

clientsRouter.get('/:id/contacts', authorize('contact.read', { load: loadClient }), async (req, res) => {
  res.json(await contacts.listContacts(req.ctx.client));
});
clientsRouter.post('/:id/contacts', authorize('contact.create', { load: loadClient }), validateBody(contactCreateSchema), async (req, res) => {
  res.status(201).json(await contacts.createContact(req.principal, req.ctx.client, req.body, req));
});

clientsRouter.get('/:id/activity', authorize('client.readDetails', { load: loadClient }), validateQuery(paginationSchema), async (req, res) => {
  const memberProjectIds = (
    await db.projectMember.findMany({ where: { user_id: req.principal.id, project: { client_id: req.ctx.client.id } }, select: { project_id: true } })
  ).map((m) => m.project_id);
  const scope = activityScope(req.principal, { memberProjectIds });
  if (!scope) throw forbidden();
  res.json(await listActivity({ client_id: req.ctx.client.id, ...scope }, req.validQuery));
});

export const contactsRouter = Router();

contactsRouter.patch('/:contactId', authorize('contact.update', { load: loadContact }), validateBody(contactUpdateSchema), async (req, res) => {
  res.json(await contacts.updateContact(req.principal, req.ctx.contact, req.body, req));
});
contactsRouter.delete('/:contactId', authorize('contact.delete', { load: loadContact }), async (req, res) => {
  await contacts.deleteContact(req.principal, req.ctx.contact, req);
  res.status(204).end();
});
