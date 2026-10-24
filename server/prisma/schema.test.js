// Checks the seed (BRD 19.1) and the database-level guards in the
// constraints_and_triggers migration, against the real test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let ws;
let owner;
let nova;
let projectA;

beforeAll(async () => {
  ws = await db.workspace.findFirstOrThrow({ where: { name: 'Nexa' } });
  owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@nexa.test' } });
  nova = await db.client.findFirstOrThrow({ where: { name_normalized: 'nova retail' } });
  projectA = await db.project.findFirstOrThrow({ where: { code: 'NOV-001' } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('seed data (BRD 19.1)', () => {
  it('creates the six internal users with their roles', async () => {
    const users = await db.user.findMany({ select: { email: true, role: true, status: true } });
    expect(Object.fromEntries(users.map((u) => [u.email, u.role]))).toEqual({
      'owner@nexa.test': 'Owner',
      'admin@nexa.test': 'Admin',
      'lina.pm@nexa.test': 'PM',
      'omar@nexa.test': 'TeamMember',
      'rana@nexa.test': 'TeamMember',
      'sami.fin@nexa.test': 'Finance',
    });
    expect(users.every((u) => u.status === 'Active')).toBe(true);
  });

  it('stores passwords only as bcrypt hashes with cost >= 12 (BR-AUTH-02)', async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: 'omar@nexa.test' } });
    expect(u.password_hash).toMatch(/^\$2[aby]\$1[2-9]\$/);
  });

  it('creates Project A: Nova Retail, In Progress, Fixed 12,000 JOD, PM Lina, member Omar', async () => {
    const p = await db.project.findFirstOrThrow({
      where: { code: 'NOV-001' },
      include: { client: true, pm_user: true, members: { include: { user: true, contact: true } } },
    });
    expect(p).toMatchObject({ name: 'E-Commerce Platform', status: 'InProgress', billing_type: 'Fixed' });
    expect(p.client.name).toBe('Nova Retail');
    expect(p.budget_amount).toBe(12_000_000n); // JOD has 3 decimals
    expect(p.pm_user.email).toBe('lina.pm@nexa.test');
    const levels = Object.fromEntries(
      p.members.map((m) => [m.user?.email ?? m.contact.email, m.project_role ?? m.portal_level]),
    );
    expect(levels).toEqual({
      'lina.pm@nexa.test': 'PM',
      'omar@nexa.test': 'Member',
      'maya@novaretail.test': 'Approve',
      'ali@novaretail.test': 'View',
    });
  });

  it('creates Project B: Bright Solutions, Not Started, Hourly, member Rana, contact omar.n (Approve)', async () => {
    const p = await db.project.findFirstOrThrow({
      where: { code: 'BRI-001' },
      include: { client: true, members: { include: { user: true, contact: true } } },
    });
    expect(p).toMatchObject({ name: 'Corporate Website', status: 'NotStarted', billing_type: 'Hourly' });
    expect(p.client.name).toBe('Bright Solutions');
    const emails = p.members.map((m) => m.user?.email ?? m.contact.email).sort();
    expect(emails).toEqual(['lina.pm@nexa.test', 'omar.n@bright.test', 'rana@nexa.test']);
  });

  it('leaves the next Nova project code at NOV-002 (TC-PRJ-001)', () => {
    expect(nova.code_prefix).toBe('NOV');
    expect(nova.next_project_number).toBe(2);
  });

  it('uses native time-ordered UUIDs and the common audit columns', () => {
    expect(projectA.id).toMatch(UUID_V7);
    expect(projectA.workspace_id).toBe(ws.id);
    expect(projectA.created_by).toBe(owner.id);
    expect(projectA.created_at).toBeInstanceOf(Date);
    expect(projectA.version).toBe(1);
  });
});

describe('database guards', () => {
  it('keeps the activity log append-only (BR-ACT-01)', async () => {
    const entry = await db.activityLog.create({
      data: {
        workspace_id: ws.id,
        actor_type: 'System',
        action: 'test.event',
        entity_type: 'Project',
        entity_id: projectA.id,
      },
    });
    await expect(db.activityLog.update({ where: { id: entry.id }, data: { action: 'changed' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.activityLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it('rejects a client contact whose email belongs to an internal user (BR-ROLE-05)', async () => {
    await expect(
      db.clientContact.create({
        data: { workspace_id: ws.id, client_id: nova.id, full_name: 'Clash', email: 'omar@nexa.test' },
      }),
    ).rejects.toMatchObject({ code: 'P2002', message: expect.stringContaining('login_email_unique') });
  });

  it('rejects an internal user whose email belongs to a client contact', async () => {
    await expect(
      db.user.create({
        data: { workspace_id: ws.id, full_name: 'Clash', email: 'maya@novaretail.test', role: 'TeamMember' },
      }),
    ).rejects.toMatchObject({ code: 'P2002', message: expect.stringContaining('login_email_unique') });
  });

  it('rejects emails that are not lowercased and trimmed (BR-AUTH-04)', async () => {
    await expect(
      db.user.create({
        data: { workspace_id: ws.id, full_name: 'Mixed', email: 'Mixed@Nexa.test', role: 'TeamMember' },
      }),
    ).rejects.toThrow(/users_email_normalized/);
  });

  it('allows only one primary contact per client (FR-CON-02)', async () => {
    await expect(
      db.clientContact.create({
        data: {
          workspace_id: ws.id,
          client_id: nova.id,
          full_name: 'Second Primary',
          email: 'second.primary@novaretail.test',
          is_primary: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate client name, ignoring case (FR-CLI-01)', async () => {
    await expect(
      db.client.create({
        data: { workspace_id: ws.id, name: 'NOVA RETAIL', name_normalized: 'nova retail', code_prefix: 'NVR', currency: 'JOD' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a project due date before its start date (BR-PRJ-02)', async () => {
    await expect(
      db.project.create({
        data: {
          workspace_id: ws.id,
          client_id: nova.id,
          name: 'Backwards',
          name_normalized: 'backwards',
          code: 'NOV-900',
          start_date: new Date('2026-11-10T00:00:00Z'),
          due_date: new Date('2026-11-01T00:00:00Z'),
          billing_type: 'Fixed',
          pm_user_id: owner.id,
        },
      }),
    ).rejects.toThrow(/projects_due_after_start/);
  });

  it('requires a member row to be either a user with a role or a contact with a portal level', async () => {
    const maya = await db.clientContact.findUniqueOrThrow({ where: { email: 'maya@novaretail.test' } });
    await expect(
      db.projectMember.create({
        data: {
          workspace_id: ws.id,
          project_id: projectA.id,
          user_id: owner.id,
          contact_id: maya.id,
          project_role: 'Member',
          portal_level: 'View',
        },
      }),
    ).rejects.toThrow(/project_members_user_xor_contact/);
  });

  it('rejects a time entry longer than 24 hours (BR-TIME-01)', async () => {
    const omar = await db.user.findUniqueOrThrow({ where: { email: 'omar@nexa.test' } });
    await expect(
      db.timeEntry.create({
        data: {
          workspace_id: ws.id,
          user_id: omar.id,
          project_id: projectA.id,
          date: new Date('2026-10-20T00:00:00Z'),
          duration_minutes: 25 * 60,
          is_billable: true,
        },
      }),
    ).rejects.toThrow(/time_entries_duration_range/);
  });
});
