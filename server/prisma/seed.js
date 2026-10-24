// Seed data from BRD section 19.1. Safe to run repeatedly: existing records are
// matched by natural keys (email, client name, project code) and left as they are.
// Every account gets SEED_PASSWORD from .env.
import bcrypt from 'bcrypt';
import { toMinor } from '@cpm/shared';
import { config } from '../src/config.js';
import { db } from '../src/lib/db.js';

if (config.isProduction) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('SEED_PASSWORD is not set (see .env.example).');
  process.exit(1);
}

const date = (iso) => new Date(`${iso}T00:00:00Z`);
const normalize = (s) => s.trim().toLowerCase();

const USERS = [
  { email: 'owner@nexa.test', full_name: 'Nexa Owner', role: 'Owner' },
  { email: 'admin@nexa.test', full_name: 'Nexa Admin', role: 'Admin' },
  { email: 'lina.pm@nexa.test', full_name: 'Lina', role: 'PM' },
  { email: 'omar@nexa.test', full_name: 'Omar', role: 'TeamMember' },
  { email: 'rana@nexa.test', full_name: 'Rana', role: 'TeamMember' },
  { email: 'sami.fin@nexa.test', full_name: 'Sami', role: 'Finance' },
];

const CLIENTS = [
  {
    name: 'Nova Retail',
    code_prefix: 'NOV',
    contacts: [
      { email: 'maya@novaretail.test', full_name: 'Maya', job_title: 'Marketing Lead', is_primary: true },
      { email: 'ali@novaretail.test', full_name: 'Ali', is_primary: false },
    ],
  },
  {
    name: 'Bright Solutions',
    code_prefix: 'BRI',
    contacts: [{ email: 'omar.n@bright.test', full_name: 'Omar N.', is_primary: true }],
  },
];

const PROJECTS = [
  {
    code: 'NOV-001',
    client: 'Nova Retail',
    name: 'E-Commerce Platform',
    status: 'InProgress',
    billing_type: 'Fixed',
    budget_amount: toMinor('12000', 'JOD'), // 12,000 JOD → 12,000,000 fils
    start_date: '2026-10-01',
    due_date: '2027-01-31',
    members: ['omar@nexa.test'],
    contacts: { 'maya@novaretail.test': 'Approve', 'ali@novaretail.test': 'View' },
  },
  {
    code: 'BRI-001',
    client: 'Bright Solutions',
    name: 'Corporate Website',
    status: 'NotStarted',
    billing_type: 'Hourly',
    budget_amount: null,
    start_date: '2026-11-01',
    due_date: '2027-02-28',
    members: ['rana@nexa.test'],
    contacts: { 'omar.n@bright.test': 'Approve' },
  },
];

async function main() {
  const workspace =
    (await db.workspace.findFirst({ where: { name: 'Nexa' } })) ??
    (await db.workspace.create({
      data: { name: 'Nexa', timezone: 'Asia/Amman', currency: 'JOD', week_start_day: 0, brand_color: '#2563EB' },
    }));
  const ws = workspace.id;

  const users = {};
  for (const u of USERS) {
    users[u.email] = await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        ...u,
        workspace_id: ws,
        status: 'Active',
        password_hash: await bcrypt.hash(password, config.bcryptCost),
      },
    });
  }
  const ownerId = users['owner@nexa.test'].id;
  const audit = { created_by: ownerId, updated_by: ownerId };
  const lina = users['lina.pm@nexa.test'];

  const clients = {};
  const contacts = {};
  for (const c of CLIENTS) {
    const client = await db.client.upsert({
      where: { workspace_id_name_normalized: { workspace_id: ws, name_normalized: normalize(c.name) } },
      update: {},
      create: {
        workspace_id: ws,
        name: c.name,
        name_normalized: normalize(c.name),
        code_prefix: c.code_prefix,
        currency: 'JOD',
        status: 'Active',
        ...audit,
      },
    });
    clients[c.name] = client;
    for (const ct of c.contacts) {
      contacts[ct.email] = await db.clientContact.upsert({
        where: { email: ct.email },
        update: {},
        create: {
          ...ct,
          workspace_id: ws,
          client_id: client.id,
          portal_access: true,
          status: 'Active',
          password_hash: await bcrypt.hash(password, config.bcryptCost),
          ...audit,
        },
      });
    }
  }

  for (const p of PROJECTS) {
    const client = clients[p.client];
    const project = await db.project.upsert({
      where: { workspace_id_code: { workspace_id: ws, code: p.code } },
      update: {},
      create: {
        workspace_id: ws,
        client_id: client.id,
        name: p.name,
        name_normalized: normalize(p.name),
        code: p.code,
        status: p.status,
        billing_type: p.billing_type,
        budget_amount: p.budget_amount,
        start_date: date(p.start_date),
        due_date: date(p.due_date),
        pm_user_id: lina.id,
        portal_enabled: true,
        ...audit,
      },
    });

    // Keep the per-client code counter ahead of seeded codes (next is NOV-002, TC-PRJ-001)
    const used = Number(p.code.split('-')[1]);
    if (client.next_project_number <= used) {
      await db.client.update({ where: { id: client.id }, data: { next_project_number: used + 1 } });
      client.next_project_number = used + 1;
    }

    const internal = [{ email: lina.email, role: 'PM' }, ...p.members.map((email) => ({ email, role: 'Member' }))];
    for (const m of internal) {
      await db.projectMember.upsert({
        where: { project_id_user_id: { project_id: project.id, user_id: users[m.email].id } },
        update: {},
        create: {
          workspace_id: ws,
          project_id: project.id,
          user_id: users[m.email].id,
          project_role: m.role,
          ...audit,
        },
      });
    }
    for (const [email, level] of Object.entries(p.contacts)) {
      await db.projectMember.upsert({
        where: { project_id_contact_id: { project_id: project.id, contact_id: contacts[email].id } },
        update: {},
        create: {
          workspace_id: ws,
          project_id: project.id,
          contact_id: contacts[email].id,
          portal_level: level,
          ...audit,
        },
      });
    }
  }

  const counts = {
    users: await db.user.count(),
    clients: await db.client.count(),
    contacts: await db.clientContact.count(),
    projects: await db.project.count(),
    memberships: await db.projectMember.count(),
  };
  console.log('Seed complete:', counts);
}

try {
  await main();
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
