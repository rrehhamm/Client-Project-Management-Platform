// Clients: FR-CLI-01…06/08, BR-CLI-03/04, client lifecycle (BRD 16.2), D-02.
import { CLIENT_STATUS, ERROR_CODES, INVOICE_STATUS, PROJECT_STATUS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { clientScope } from '../../auth/scopes.js';
import { revokeAllSessions } from '../../auth/sessions.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, conflict, staleUpdate, transitionNotAllowed } from '../../lib/errors.js';
import { suggestPrefix } from './prefix.js';

const normalizeName = (name) => name.trim().toLowerCase();
const AUDITED = ['name', 'status', 'code_prefix', 'currency', 'default_bill_rate', 'payment_terms_days', 'industry', 'website', 'tax_id'];
/** BR-CLI-03 */
const OUTSTANDING_STATUSES = [INVOICE_STATUS.SENT, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.OVERDUE];
const ACTIVE_PROJECT_STATUSES = [PROJECT_STATUS.NOT_STARTED, PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.ON_HOLD];

/** Direct status changes (BRD 16.2). Archived only via archive/restore. */
const CLIENT_TRANSITIONS = {
  [CLIENT_STATUS.LEAD]: [CLIENT_STATUS.ACTIVE],
  [CLIENT_STATUS.ACTIVE]: [CLIENT_STATUS.INACTIVE],
  [CLIENT_STATUS.INACTIVE]: [CLIENT_STATUS.ACTIVE],
  [CLIENT_STATUS.ARCHIVED]: [],
};

const duplicateName = () =>
  conflict('A client with this name already exists', [{ field: 'name', message: 'A client with this name already exists' }]); // FR-CLI-01

/** Public shape. Team Members get the name only; internal notes only for readDetails roles (FR-CLI-08). */
export function toClientDto(c, viewer, extras = {}) {
  if (!can(viewer, 'client.readDetails')) return { id: c.id, name: c.name };
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    code_prefix: c.code_prefix,
    code_prefix_locked: Boolean(c.code_prefix_locked_at),
    industry: c.industry,
    website: c.website,
    billing_address: c.billing_address,
    tax_id: c.tax_id,
    currency: c.currency,
    default_bill_rate: c.default_bill_rate,
    payment_terms_days: c.payment_terms_days,
    internal_notes: c.internal_notes,
    archived_at: c.archived_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
    version: c.version,
    ...extras,
  };
}

/** Outstanding balance per client id (BR-CLI-03). */
async function outstandingByClient(clientIds) {
  if (!clientIds.length) return new Map();
  const rows = await db.invoice.groupBy({
    by: ['client_id'],
    where: { client_id: { in: clientIds }, status: { in: OUTSTANDING_STATUSES } },
    _sum: { balance: true },
  });
  return new Map(rows.map((r) => [r.client_id, r._sum.balance ?? 0n]));
}

const primaryContactSelect = {
  contacts: { where: { is_primary: true }, take: 1, select: { id: true, full_name: true, email: true } },
};

export function findClientInWorkspace(workspaceId, id) {
  return db.client.findFirst({ where: { id, workspace_id: workspaceId } });
}

// ---------------------------------------------------------------------------
// List / detail (FR-CLI-03, FR-CLI-04)
// ---------------------------------------------------------------------------

export async function listClients(viewer, { page, page_size: pageSize, q, status, sort, order }) {
  const where = {
    workspace_id: viewer.workspace_id,
    ...clientScope(viewer),
    // Archived clients only when asked for (hidden from pickers, FR-CLI-05)
    ...(status ? { status } : { status: { not: CLIENT_STATUS.ARCHIVED } }),
    ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
  };
  const detailed = can(viewer, 'client.readDetails');
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: [{ [sort]: order }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: detailed
        ? {
            ...primaryContactSelect,
            _count: { select: { projects: { where: { deleted_at: null, archived_at: null, status: { in: ACTIVE_PROJECT_STATUSES } } } } },
          }
        : undefined,
    }),
    db.client.count({ where }),
  ]);
  const balances = detailed ? await outstandingByClient(rows.map((r) => r.id)) : new Map();
  return {
    data: rows.map((c) =>
      toClientDto(c, viewer, {
        primary_contact: c.contacts?.[0] ?? null,
        active_projects: c._count?.projects ?? 0,
        outstanding_balance: balances.get(c.id) ?? 0n,
      }),
    ),
    page,
    page_size: pageSize,
    total,
  };
}

export async function getClientDetail(viewer, client) {
  if (!can(viewer, 'client.readDetails')) return toClientDto(client, viewer);
  const [full, balances, projectsActive, projectsTotal, contacts, proposals, contracts, invoices] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: client.id }, include: primaryContactSelect }),
    outstandingByClient([client.id]),
    db.project.count({ where: { client_id: client.id, deleted_at: null, archived_at: null, status: { in: ACTIVE_PROJECT_STATUSES } } }),
    db.project.count({ where: { client_id: client.id, deleted_at: null } }),
    db.clientContact.count({ where: { client_id: client.id } }),
    db.proposal.count({ where: { client_id: client.id } }),
    db.contract.count({ where: { client_id: client.id } }),
    db.invoice.count({ where: { client_id: client.id } }),
  ]);
  return toClientDto(full, viewer, {
    primary_contact: full.contacts[0] ?? null,
    outstanding_balance: balances.get(client.id) ?? 0n,
    counts: { projects: projectsTotal, active_projects: projectsActive, contacts, proposals, contracts, invoices },
  });
}

// ---------------------------------------------------------------------------
// Create / update (FR-CLI-01, FR-CLI-02, D-02)
// ---------------------------------------------------------------------------

async function assertNameFree(workspaceId, name, exceptId) {
  const existing = await db.client.findFirst({
    where: { workspace_id: workspaceId, name_normalized: normalizeName(name), ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw duplicateName();
}

async function assertPrefixFree(workspaceId, prefix, exceptId) {
  const existing = await db.client.findFirst({
    where: { workspace_id: workspaceId, code_prefix: prefix, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw conflict('This prefix is used by another client', [{ field: 'code_prefix', message: 'Already used' }]);
}

export async function createClient(viewer, body, req) {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id } });
  await assertNameFree(workspace.id, body.name);
  let prefix = body.code_prefix;
  if (prefix) await assertPrefixFree(workspace.id, prefix);
  else prefix = await suggestPrefix(workspace.id, body.name);

  const created = await db.client.create({
    data: {
      ...body,
      workspace_id: workspace.id,
      name_normalized: normalizeName(body.name),
      code_prefix: prefix,
      status: body.status ?? CLIENT_STATUS.ACTIVE, // FR-CLI-01
      currency: body.currency ?? workspace.currency,
      created_by: viewer.id,
      updated_by: viewer.id,
    },
  });
  await writeAudit({ req, action: 'client.created', entityType: 'Client', entityId: created.id, clientId: created.id, after: pick(created, AUDITED) });
  return toClientDto(created, viewer, { primary_contact: null, outstanding_balance: 0n });
}

export async function updateClient(viewer, client, { version, ...changes }, req) {
  if (changes.name !== undefined && normalizeName(changes.name) !== client.name_normalized) {
    await assertNameFree(client.workspace_id, changes.name, client.id);
  }
  if (changes.code_prefix !== undefined && changes.code_prefix !== client.code_prefix) {
    if (client.code_prefix_locked_at) {
      throw conflict('The project-code prefix is locked because this client already has projects', [
        { field: 'code_prefix', message: 'Locked after the first project' },
      ]); // D-02
    }
    await assertPrefixFree(client.workspace_id, changes.code_prefix, client.id);
  }
  if (changes.currency !== undefined && changes.currency !== client.currency) {
    if ((await db.invoice.count({ where: { client_id: client.id } })) > 0) {
      throw conflict('The currency cannot change once the client has an invoice', [{ field: 'currency', message: 'Locked: invoices exist' }]); // FR-CLI-02
    }
  }
  if (changes.status !== undefined && changes.status !== client.status) {
    if (!CLIENT_TRANSITIONS[client.status].includes(changes.status)) throw transitionNotAllowed();
  }

  const data = { ...changes, version: { increment: 1 }, updated_by: viewer.id };
  if (changes.name !== undefined) data.name_normalized = normalizeName(changes.name);
  let res;
  try {
    res = await db.client.updateMany({ where: { id: client.id, version }, data });
  } catch (err) {
    if (err?.code === 'P2002') throw duplicateName();
    throw err;
  }
  if (res.count !== 1) throw staleUpdate();
  const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
  const changed = AUDITED.filter((k) => k in changes && String(client[k]) !== String(after[k]));
  if (changed.length) {
    await writeAudit({
      req,
      action: changed.includes('status') ? 'client.status_changed' : 'client.updated',
      entityType: 'Client',
      entityId: client.id,
      clientId: client.id,
      before: pick(client, changed),
      after: pick(after, changed),
    });
  }
  return getClientDetail(viewer, after);
}

// ---------------------------------------------------------------------------
// Archive / restore / delete (FR-CLI-05, FR-CLI-06, BR-CLI-04)
// ---------------------------------------------------------------------------

export async function archiveClient(viewer, client, req) {
  if (client.status === CLIENT_STATUS.ARCHIVED) throw conflict('This client is already archived');
  const inProgress = await db.project.count({ where: { client_id: client.id, deleted_at: null, status: PROJECT_STATUS.IN_PROGRESS } });
  if (inProgress > 0) {
    throw conflict(`This client has ${inProgress} project${inProgress === 1 ? '' : 's'} in progress. Finish or pause them first.`);
  }
  const after = await db.$transaction(async (tx) => {
    const updated = await tx.client.update({
      where: { id: client.id },
      data: { status: CLIENT_STATUS.ARCHIVED, archived_at: new Date(), version: { increment: 1 }, updated_by: viewer.id },
    });
    // Portal logins are disabled (FR-CLI-05): sign out every contact now.
    const contacts = await tx.clientContact.findMany({ where: { client_id: client.id }, select: { id: true } });
    for (const c of contacts) await revokeAllSessions({ contactId: c.id }, 'client_archived', { client: tx });
    await writeAudit(
      { req, action: 'client.archived', entityType: 'Client', entityId: client.id, clientId: client.id, before: { status: client.status }, after: { status: updated.status } },
      tx,
    );
    return updated;
  });
  return getClientDetail(viewer, after);
}

export async function restoreClient(viewer, client, req) {
  if (client.status !== CLIENT_STATUS.ARCHIVED) throw conflict('Only archived clients can be restored');
  const after = await db.client.update({
    where: { id: client.id },
    data: { status: CLIENT_STATUS.ACTIVE, archived_at: null, version: { increment: 1 }, updated_by: viewer.id },
  });
  await writeAudit({ req, action: 'client.restored', entityType: 'Client', entityId: client.id, clientId: client.id, before: { status: client.status }, after: { status: after.status } });
  return getClientDetail(viewer, after);
}

export async function deleteClient(_viewer, client, req) {
  // Financial records and projects are never deleted with the client (BRD 5.2).
  const [projects, proposals, contracts, invoices] = await Promise.all([
    db.project.count({ where: { client_id: client.id } }), // soft-deleted projects count too
    db.proposal.count({ where: { client_id: client.id } }),
    db.contract.count({ where: { client_id: client.id } }),
    db.invoice.count({ where: { client_id: client.id } }),
  ]);
  const counts = { projects, proposals, contracts, invoices };
  const blocking = Object.entries(counts).filter(([, n]) => n > 0);
  if (blocking.length) {
    const list = blocking.map(([k, n]) => `${n} ${n === 1 ? k.slice(0, -1) : k}`).join(', ');
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `This client has ${list}. Archive it instead.`,
      blocking.map(([field, n]) => ({ field, message: String(n) })),
    ); // FR-CLI-06, TC-CLI-002
  }
  await db.$transaction(async (tx) => {
    await tx.clientContact.deleteMany({ where: { client_id: client.id } });
    await tx.client.delete({ where: { id: client.id } });
    await writeAudit({ req, action: 'client.deleted', entityType: 'Client', entityId: client.id, clientId: client.id, before: pick(client, ['name', 'status', 'code_prefix']) }, tx);
  });
}

export async function suggestPrefixFor(viewer, name) {
  return { code_prefix: await suggestPrefix(viewer.workspace_id, name) };
}

