// API tests for clients and contacts: FR-CLI-01…06/08, FR-CON-01/02, BR-CLI-03/04,
// BR-ROLE-05/06, D-02, D-16, D-22, TC-CLI-001…004.
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_PASSWORD, apiCreateClient, apiCreateProject, auditEntries, client, loginAs, uniqueClientName, uniqueEmail } from '../../../test/helpers.js';
import { createWorld } from '../../../test/fixtures.js';

vi.mock('../../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue({}), pingMail: vi.fn() }));

const { createApp } = await import('../../app.js');
const { db } = await import('../../lib/db.js');
const { prefixCandidates } = await import('./prefix.js');

const app = createApp();
let W; // E-01: this file's own workspace
const as = {};
let nova;
let bright;

beforeAll(async () => {
  W = await createWorld('Clients');
  Object.assign(as, await W.loginAll(app));
  as.Anonymous = await client(app);
  nova = W.clients.nova;
  bright = W.clients.bright;
});

// ---------------------------------------------------------------------------
describe('project-code prefix (D-02)', () => {
  it('suggests the first three letters, then first letter + consonants (Nova Retail → NOV, then NVR)', () => {
    expect(prefixCandidates('Nova Retail').slice(0, 2)).toEqual(['NOV', 'NVR']);
    expect(prefixCandidates('Éclair Café')[0]).toBe('ECL');
  });

  it('suggests NVR for a second "Nova Retail…" client because NOV is taken', async () => {
    const res = await as.PM.get('/api/v1/clients/prefix-suggestion?name=Nova%20Retail%20Group');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code_prefix: 'NVR' });
  });

  it('a new client gets a free suggested prefix; a taken explicit prefix is 409', async () => {
    const c = await apiCreateClient(as.PM, { name: `Novatech ${Date.now()}` });
    expect(c.code_prefix).toMatch(/^N[A-Z]{2}$/);
    expect(c.code_prefix).not.toBe('NOV');
    const taken = await as.PM.post('/api/v1/clients', { name: uniqueClientName(), code_prefix: 'NOV' });
    expect(taken.status).toBe(409);
    expect(taken.body.fields[0].field).toBe('code_prefix');
  });

  it('the prefix can change until the first project exists, then it is locked', async () => {
    const c = await apiCreateClient(as.Admin);
    const free = `Q${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const changed = await as.Admin.patch(`/api/v1/clients/${c.id}`, { code_prefix: free, version: c.version });
    expect([200, 409]).toContain(changed.status); // 409 only if the random prefix is taken
    const fresh = (await as.Admin.get(`/api/v1/clients/${c.id}`)).body;
    await apiCreateProject(as.Admin, { pmId: W.users.pm.id, clientId: c.id });
    const after = (await as.Admin.get(`/api/v1/clients/${c.id}`)).body;
    expect(after.code_prefix_locked).toBe(true);
    const locked = await as.Admin.patch(`/api/v1/clients/${c.id}`, { code_prefix: 'ZZZ', version: after.version });
    expect(locked.status).toBe(409);
    expect(locked.body.message).toMatch(/locked/i);
    expect((await as.Admin.get(`/api/v1/clients/${c.id}`)).body.code_prefix).toBe(fresh.code_prefix);
  });
});

// ---------------------------------------------------------------------------
describe('create and edit (FR-CLI-01, FR-CLI-02)', () => {
  it('creates with defaults: status Active, workspace currency', async () => {
    const c = await apiCreateClient(as.PM, { name: '  Spaced Name Co  ' });
    expect(c).toMatchObject({ name: 'Spaced Name Co', status: 'Active', currency: 'JOD', code_prefix: expect.stringMatching(/^[A-Z]{3}$/) });
    const [entry] = await auditEntries('client.created', { entity_id: c.id });
    expect(entry.client_id).toBe(c.id);
  });

  it('TC-CLI-001: "nova retail " duplicates "Nova Retail" (case + trim) → 409', async () => {
    const res = await as.PM.post('/api/v1/clients', { name: 'nova retail ' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A client with this name already exists');
  });

  it('validates the name length (2–120) and the website', async () => {
    expect((await as.PM.post('/api/v1/clients', { name: 'X' })).status).toBe(422);
    expect((await as.PM.post('/api/v1/clients', { name: uniqueClientName(), website: 'not a url' })).status).toBe(422);
  });

  it('TC-CLI-004: the currency cannot change once an invoice exists', async () => {
    const c = await apiCreateClient(as.Admin);
    await db.invoice.create({
      data: { workspace_id: nova.workspace_id, client_id: c.id, issue_date: new Date('2026-10-01'), due_date: new Date('2026-10-31'), currency: 'JOD' },
    });
    const res = await as.Admin.patch(`/api/v1/clients/${c.id}`, { currency: 'USD', version: c.version });
    expect(res.status).toBe(409);
    expect(res.body.fields[0].field).toBe('currency');
  });

  it('client status follows BRD 16.2: Lead → Active allowed, Active → Lead refused, Archived only via archive', async () => {
    const c = await apiCreateClient(as.Admin, { status: 'Lead' });
    const ok = await as.Admin.patch(`/api/v1/clients/${c.id}`, { status: 'Active', version: c.version });
    expect(ok.status).toBe(200);
    const back = await as.Admin.patch(`/api/v1/clients/${c.id}`, { status: 'Lead', version: ok.body.version });
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('TRANSITION_NOT_ALLOWED');
    expect((await as.Admin.patch(`/api/v1/clients/${c.id}`, { status: 'Archived', version: ok.body.version })).status).toBe(422);
  });

  it('a stale version gets 409 (NFR-CONC-01)', async () => {
    const c = await apiCreateClient(as.Admin);
    await as.Admin.patch(`/api/v1/clients/${c.id}`, { industry: 'Retail', version: c.version });
    const stale = await as.PM.patch(`/api/v1/clients/${c.id}`, { industry: 'Food', version: c.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
  });
});

// ---------------------------------------------------------------------------
describe('list and detail (FR-CLI-03, FR-CLI-04, FR-CLI-08, BR-CLI-03)', () => {
  it('lists name, status, primary contact, active projects and outstanding balance', async () => {
    const res = await as.Admin.get('/api/v1/clients?q=nova%20retail');
    const row = res.body.data.find((c) => c.id === nova.id);
    expect(row).toMatchObject({ status: 'Active', primary_contact: { email: W.contacts.maya.email }, active_projects: 1, outstanding_balance: 0 });
    expect(res.body).toMatchObject({ page: 1, page_size: 25 });
  });

  it('outstanding balance sums Sent, Partially paid and Overdue invoices only', async () => {
    const c = await apiCreateClient(as.Admin);
    const base = { workspace_id: nova.workspace_id, client_id: c.id, issue_date: new Date('2026-10-01'), due_date: new Date('2026-10-31'), currency: 'JOD' };
    await db.invoice.createMany({
      data: [
        { ...base, status: 'Sent', balance: 1000n },
        { ...base, status: 'PartiallyPaid', balance: 500n },
        { ...base, status: 'Overdue', balance: 250n },
        { ...base, status: 'Draft', balance: 9999n },
        { ...base, status: 'Paid', balance: 0n },
      ],
    });
    expect((await as.Finance.get(`/api/v1/clients/${c.id}`)).body.outstanding_balance).toBe(1750);
  });

  it('a Team Member lists only clients of their projects, by name only', async () => {
    const res = await as.TeamMember.get('/api/v1/clients?page_size=100');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: nova.id, name: 'Nova Retail' }]);
    const other = await as.TeamMember2.get('/api/v1/clients?page_size=100');
    expect(other.body.data.map((c) => c.name)).toEqual(['Bright Solutions']);
  });

  it('internal notes are for internal roles with details only, never for contacts (FR-CLI-08)', async () => {
    const fresh = await db.client.findUniqueOrThrow({ where: { id: nova.id } });
    await as.PM.patch(`/api/v1/clients/${nova.id}`, { internal_notes: 'Pays late', version: fresh.version });
    expect((await as.PM.get(`/api/v1/clients/${nova.id}`)).body.internal_notes).toBe('Pays late');
    expect((await as.TeamMember.get(`/api/v1/clients/${nova.id}`)).body).toEqual({ id: nova.id, name: 'Nova Retail' });
    expect((await as.Contact.get(`/api/v1/clients/${nova.id}`)).status).toBe(404); // D-40: internal API
  });

  it('a Team Member cannot open a client they do not work for; a contact gets 404 for another client', async () => {
    expect((await as.TeamMember.get(`/api/v1/clients/${bright.id}`)).status).toBe(403);
    expect((await as.Contact.get(`/api/v1/clients/${bright.id}`)).status).toBe(404);
  });

  it('detail carries counts of related records', async () => {
    const res = await as.Admin.get(`/api/v1/clients/${nova.id}`);
    // Other test files add contacts to Nova Retail, so compare with the database
    const contacts = await db.clientContact.count({ where: { client_id: nova.id } });
    const projects = await db.project.count({ where: { client_id: nova.id, deleted_at: null } });
    expect(res.body.counts).toMatchObject({ projects, contacts, proposals: 0, contracts: 0, invoices: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('archive, restore, delete (FR-CLI-05, FR-CLI-06, BR-CLI-04)', () => {
  it('TC-CLI-003: archiving a client without In Progress projects blocks its contacts from signing in', async () => {
    const res = await as.Admin.post(`/api/v1/clients/${bright.id}/archive`);
    try {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Archived');
      const login = await (await client(app)).post('/api/v1/auth/login', { email: W.contacts.omarN.email, password: SEED_PASSWORD });
      expect(login.status).toBe(403);
      expect(login.body.message).toBe('Portal access is disabled');
      // hidden from the default list (pickers), shown when asked for
      expect((await as.Admin.get('/api/v1/clients?page_size=100')).body.data.map((c) => c.id)).not.toContain(bright.id);
      expect((await as.Admin.get('/api/v1/clients?status=Archived&page_size=100')).body.data.map((c) => c.id)).toContain(bright.id);
      // contacts keep their records (BR-CLI-04)
      expect(await db.clientContact.count({ where: { client_id: bright.id } })).toBe(1);
    } finally {
      const restore = await as.Admin.post(`/api/v1/clients/${bright.id}/restore`);
      expect(restore.body.status).toBe('Active');
    }
  });

  it('a client with an In Progress project cannot be archived', async () => {
    const res = await as.Admin.post(`/api/v1/clients/${nova.id}/archive`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/in progress/);
  });

  it('archiving signs out its contacts immediately', async () => {
    const c = await apiCreateClient(as.Admin);
    const contact = (await as.Admin.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Portal Person', email: uniqueEmail('portal') })).body;
    await db.clientContact.update({ where: { id: contact.id }, data: { portal_access: true, status: 'Active', password_hash: (W.users.admin).password_hash } });
    const session = await loginAs(app, contact.email);
    await as.Admin.post(`/api/v1/clients/${c.id}/archive`);
    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('TC-CLI-002: deleting a client with projects → 409 with counts; the client remains', async () => {
    const res = await as.Admin.delete(`/api/v1/clients/${nova.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Archive it instead/);
    expect(res.body.fields).toContainEqual({ field: 'projects', message: expect.stringMatching(/^\d+$/) });
    expect(await db.client.findUnique({ where: { id: nova.id } })).not.toBeNull();
  });

  it('a client with no projects, proposals, contracts or invoices can be deleted, with its contacts', async () => {
    const c = await apiCreateClient(as.Admin);
    await as.Admin.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Gone Soon', email: uniqueEmail('gone') });
    expect((await as.Admin.delete(`/api/v1/clients/${c.id}`)).status).toBe(204);
    expect(await db.client.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.clientContact.count({ where: { client_id: c.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('permissions (4.2 Clients and Client contacts rows)', () => {
  it('create: Team Member and Finance 403, contact 404, anonymous 401', async () => {
    const name = uniqueClientName('Denied');
    expect((await as.TeamMember.post('/api/v1/clients', { name })).status).toBe(403);
    expect((await as.Finance.post('/api/v1/clients', { name })).status).toBe(403);
    expect((await as.Contact.post('/api/v1/clients', { name })).status).toBe(404);
    expect((await as.Anonymous.post('/api/v1/clients', { name })).status).toBe(401);
    expect(await db.client.findFirst({ where: { name } })).toBeNull();
  });

  it('update: Team Member and Finance 403; delete: PM 403', async () => {
    const c = await apiCreateClient(as.Admin);
    expect((await as.TeamMember.patch(`/api/v1/clients/${c.id}`, { industry: 'x', version: c.version })).status).toBe(403);
    expect((await as.Finance.patch(`/api/v1/clients/${c.id}`, { industry: 'x', version: c.version })).status).toBe(403);
    expect((await as.PM.delete(`/api/v1/clients/${c.id}`)).status).toBe(403);
    expect((await db.client.findUniqueOrThrow({ where: { id: c.id } })).version).toBe(c.version);
  });

  it('contacts: Finance reads but cannot add; Team Member cannot read', async () => {
    expect((await as.Finance.get(`/api/v1/clients/${nova.id}/contacts`)).status).toBe(200);
    expect((await as.Finance.post(`/api/v1/clients/${nova.id}/contacts`, { full_name: 'X', email: uniqueEmail('x') })).status).toBe(403);
    expect((await as.TeamMember.get(`/api/v1/clients/${nova.id}/contacts`)).status).toBe(403);
  });

  it('activity: Owner/Admin/PM read the client feed; Finance sees finance events only; Team Member 403', async () => {
    const c = await apiCreateClient(as.PM);
    const feed = await as.PM.get(`/api/v1/clients/${c.id}/activity`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.map((e) => e.action)).toContain('client.created');
    expect(feed.body.data[0].actor.name).toBe('Lina');
    expect(JSON.stringify(feed.body)).not.toContain('user_agent');
    expect((await as.Finance.get(`/api/v1/clients/${c.id}/activity`)).body.data).toEqual([]);
    expect((await as.TeamMember.get(`/api/v1/clients/${nova.id}/activity`)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('contacts (FR-CON-01, FR-CON-02, D-16, D-22, BR-ROLE-05/06)', () => {
  it('the first contact becomes primary with commercial authority; a new primary replaces the old one', async () => {
    const c = await apiCreateClient(as.PM);
    const first = await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'First', email: uniqueEmail('first') });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ is_primary: true, commercial_authority: true, portal_access: false });

    const second = await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Second', email: uniqueEmail('second'), is_primary: true });
    expect(second.body).toMatchObject({ is_primary: true, commercial_authority: true });
    const list = (await as.PM.get(`/api/v1/clients/${c.id}/contacts`)).body.data;
    expect(list.filter((x) => x.is_primary)).toHaveLength(1);
    expect(list.find((x) => x.id === first.body.id)).toMatchObject({ is_primary: false, commercial_authority: true }); // keeps its flag

    const third = await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Third', email: uniqueEmail('third') });
    expect(third.body).toMatchObject({ is_primary: false, commercial_authority: false });
  });

  it('PM grants and revokes commercial authority (D-16)', async () => {
    const c = await apiCreateClient(as.PM);
    await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Primary', email: uniqueEmail('p') });
    const other = (await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Other', email: uniqueEmail('o') })).body;
    const granted = await as.PM.patch(`/api/v1/contacts/${other.id}`, { commercial_authority: true, version: other.version });
    expect(granted.body.commercial_authority).toBe(true);
    const revoked = await as.PM.patch(`/api/v1/contacts/${other.id}`, { commercial_authority: false, version: granted.body.version });
    expect(revoked.body.commercial_authority).toBe(false);
  });

  it('a client always keeps a primary contact', async () => {
    const c = await apiCreateClient(as.PM);
    const only = (await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'Only', email: uniqueEmail('only') })).body;
    const res = await as.PM.patch(`/api/v1/contacts/${only.id}`, { is_primary: false, version: only.version });
    expect(res.status).toBe(409);
  });

  it('emails are unique across contacts and internal users (FR-CON-01, BR-ROLE-05)', async () => {
    const c = await apiCreateClient(as.PM);
    expect((await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'X', email: W.users.member.email })).status).toBe(409);
    expect((await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'X', email: W.contacts.maya.email })).status).toBe(409);
  });

  it('BR-ROLE-06: a contact cannot be moved to another client', async () => {
    const maya = W.contacts.maya;
    const res = await as.Admin.patch(`/api/v1/contacts/${maya.id}`, { client_id: bright.id, version: maya.version });
    expect(res.status).toBe(422);
    expect((await db.clientContact.findUniqueOrThrow({ where: { id: maya.id } })).client_id).toBe(nova.id);
  });

  it('D-22: only contacts without history can be deleted; the primary only when it is the last one', async () => {
    const maya = W.contacts.maya;
    const withHistory = await as.Admin.delete(`/api/v1/contacts/${maya.id}`);
    expect(withHistory.status).toBe(409);
    expect(withHistory.body.message).toMatch(/portal access/);

    const c = await apiCreateClient(as.PM);
    const primary = (await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'P', email: uniqueEmail('p') })).body;
    const other = (await as.PM.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'O', email: uniqueEmail('o') })).body;
    expect((await as.PM.delete(`/api/v1/contacts/${primary.id}`)).status).toBe(409);
    expect((await as.PM.delete(`/api/v1/contacts/${other.id}`)).status).toBe(204);
    expect((await as.PM.delete(`/api/v1/contacts/${primary.id}`)).status).toBe(204);
  });

  it('contacts of an archived client cannot be added', async () => {
    const c = await apiCreateClient(as.Admin);
    await as.Admin.post(`/api/v1/clients/${c.id}/archive`);
    expect((await as.Admin.post(`/api/v1/clients/${c.id}/contacts`, { full_name: 'X', email: uniqueEmail('x') })).status).toBe(409);
  });
});

describe('unauthenticated', () => {
  it('401 on the client list', async () => {
    expect((await request(app).get('/api/v1/clients')).status).toBe(401);
  });
});
