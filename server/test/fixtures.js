// E-01: every test file builds its own workspace with the BRD 19.1 cast, so test
// files never share data and can run in any order or in parallel.
// Emails are random (login emails are unique platform-wide, D-05).
import { randomUUID } from 'node:crypto';
import { toMinor } from '@cpm/shared';
import { hashPassword } from '../src/auth/passwords.js';
import { db } from '../src/lib/db.js';
import { SEED_PASSWORD, loginAs } from './helpers.js';

const date = (iso) => new Date(`${iso}T00:00:00Z`);

/**
 * Create an isolated workspace:
 *   users:    owner, admin, pm (Lina), member (Omar), member2 (Rana), finance (Sami)
 *   clients:  nova (Nova Retail, NOV), bright (Bright Solutions, BRI)
 *   contacts: maya (Nova, primary, Approve on A), ali (Nova, View on A), omarN (Bright, Approve on B)
 *   projects: A = NOV-001 In Progress, Fixed 12,000 JOD, PM Lina, member Omar
 *             B = BRI-001 Not Started, Hourly, PM Lina, member Rana
 * Next Nova project code is NOV-002 (TC-PRJ-001).
 */
export async function createWorld(label = 'World') {
  const tag = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const email = (name) => `${name}-${tag}@test.local`;

  const workspace = await db.workspace.create({
    data: { name: `${label} ${tag}`, timezone: 'Asia/Amman', currency: 'JOD', week_start_day: 0, brand_color: '#2563EB' },
  });
  const ws = workspace.id;

  const userSpecs = {
    owner: ['Nexa Owner', 'Owner'],
    admin: ['Nexa Admin', 'Admin'],
    pm: ['Lina', 'PM'],
    member: ['Omar', 'TeamMember'],
    member2: ['Rana', 'TeamMember'],
    finance: ['Sami', 'Finance'],
  };
  const users = {};
  for (const [key, [fullName, role]] of Object.entries(userSpecs)) {
    users[key] = await db.user.create({
      data: { workspace_id: ws, email: email(key), full_name: fullName, role, status: 'Active', password_hash: passwordHash },
    });
  }
  const audit = { created_by: users.owner.id, updated_by: users.owner.id };

  const clientRow = (name, prefix) =>
    db.client.create({
      data: { workspace_id: ws, name, name_normalized: name.toLowerCase(), code_prefix: prefix, currency: 'JOD', status: 'Active', next_project_number: 2, code_prefix_locked_at: new Date(), ...audit },
    });
  const clients = { nova: await clientRow('Nova Retail', 'NOV'), bright: await clientRow('Bright Solutions', 'BRI') };

  const contactRow = (clientId, key, fullName, primary) =>
    db.clientContact.create({
      data: {
        workspace_id: ws,
        client_id: clientId,
        full_name: fullName,
        email: email(key),
        portal_access: true,
        status: 'Active',
        is_primary: primary,
        commercial_authority: primary,
        password_hash: passwordHash,
        ...audit,
      },
    });
  const contacts = {
    maya: await contactRow(clients.nova.id, 'maya', 'Maya', true),
    ali: await contactRow(clients.nova.id, 'ali', 'Ali', false),
    omarN: await contactRow(clients.bright.id, 'omar-n', 'Omar N.', true),
  };

  const projectRow = (client, code, name, status, billing, budget, start, due) =>
    db.project.create({
      data: {
        workspace_id: ws,
        client_id: client.id,
        name,
        name_normalized: name.toLowerCase(),
        code,
        status,
        billing_type: billing,
        budget_amount: budget,
        start_date: date(start),
        due_date: date(due),
        pm_user_id: users.pm.id,
        portal_enabled: true,
        ...audit,
      },
    });
  const projects = {
    A: await projectRow(clients.nova, 'NOV-001', 'E-Commerce Platform', 'InProgress', 'Fixed', toMinor('12000', 'JOD'), '2026-10-01', '2027-01-31'),
    B: await projectRow(clients.bright, 'BRI-001', 'Corporate Website', 'NotStarted', 'Hourly', null, '2026-11-01', '2027-02-28'),
  };

  const member = (project, data) => db.projectMember.create({ data: { workspace_id: ws, project_id: project.id, ...data, ...audit } });
  await member(projects.A, { user_id: users.pm.id, project_role: 'PM' });
  await member(projects.A, { user_id: users.member.id, project_role: 'Member' });
  await member(projects.A, { contact_id: contacts.maya.id, portal_level: 'Approve' });
  await member(projects.A, { contact_id: contacts.ali.id, portal_level: 'View' });
  await member(projects.B, { user_id: users.pm.id, project_role: 'PM' });
  await member(projects.B, { user_id: users.member2.id, project_role: 'Member' });
  await member(projects.B, { contact_id: contacts.omarN.id, portal_level: 'Approve' });

  const world = {
    tag,
    workspace,
    users,
    clients,
    contacts,
    projects,
    email,
    /** Signed-in API client for a user or contact key, e.g. world.login(app, 'pm'). */
    login: (app, key) => loginAs(app, (users[key] ?? contacts[key]).email),
    /** Log in as every internal role plus Maya; returns { Owner, Admin, PM, TeamMember, TeamMember2, Finance, Contact }. */
    async loginAll(app) {
      const keys = { Owner: 'owner', Admin: 'admin', PM: 'pm', TeamMember: 'member', TeamMember2: 'member2', Finance: 'finance', Contact: 'maya' };
      const out = {};
      await Promise.all(Object.entries(keys).map(async ([role, key]) => (out[role] = await world.login(app, key))));
      return out;
    },
    /** Extra internal user in this workspace. */
    async addUser({ role = 'TeamMember', status = 'Active', fullName } = {}) {
      return db.user.create({
        data: {
          workspace_id: ws,
          email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`,
          full_name: fullName ?? `Test ${role}`,
          role,
          status,
          password_hash: status === 'Invited' ? null : passwordHash,
        },
      });
    },
    /** Extra contact (on Nova unless clientId is given). */
    async addContact({ clientId, portalAccess = true, status = 'Active' } = {}) {
      return db.clientContact.create({
        data: {
          workspace_id: ws,
          client_id: clientId ?? clients.nova.id,
          full_name: 'Test Contact',
          email: `contact-${randomUUID().slice(0, 8)}@test.local`,
          portal_access: portalAccess,
          status,
          password_hash: passwordHash,
        },
      });
    },
  };
  return world;
}
