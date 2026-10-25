// Table-driven tests of the BRD 4.2 permission matrix through can().
// Each case states, for one situation, exactly which principals are allowed.
import { describe, expect, it } from 'vitest';
import { can } from './can.js';
import { ACTIONS, RULES } from './permissions.js';

const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';

const P = {
  Owner: { kind: 'user', id: 'u-owner', role: 'Owner' },
  Admin: { kind: 'user', id: 'u-admin', role: 'Admin' },
  PM: { kind: 'user', id: 'u-pm', role: 'PM' },
  TeamMember: { kind: 'user', id: 'u-tm', role: 'TeamMember' },
  Finance: { kind: 'user', id: 'u-fin', role: 'Finance' },
  Contact: { kind: 'contact', id: 'c-maya', role: null, client_id: CLIENT_A },
};
const ALL = Object.keys(P);

/**
 * Build the ctx a route loader would produce for principal `p`.
 * member: p is on the project; level: contact portal level; own/assigned: p
 * created / is assigned the record; visibility: record visibility.
 */
function ctxFor(p, { pm = false, member = false, level = 'View', portal = true, projectClient = CLIENT_A, own = false, assigned = false, visibility = 'Internal', status, extra = {}, record = {} } = {}) {
  const membership = member
    ? p.kind === 'contact'
      ? { contact_id: p.id, portal_level: level }
      : { user_id: p.id, project_role: p.role === 'PM' ? 'PM' : 'Member' }
    : null;
  return {
    membership,
    project: { client_id: projectClient, portal_enabled: portal, pm_user_id: pm ? p.id : "someone-else" },
    record: {
      visibility,
      created_by: own ? p.id : 'someone-else',
      assignee_ids: assigned ? [p.id] : [],
      status,
      client_id: projectClient,
      ...record,
    },
    ...extra,
  };
}

function allowedRoles(action, opts) {
  return ALL.filter((role) => can(P[role], action, ctxFor(P[role], opts)));
}

const expectAllowed = (action, opts, expected) =>
  expect(allowedRoles(action, opts), `${action} ${JSON.stringify(opts)}`).toEqual(ALL.filter((r) => expected.includes(r)));

describe('can()', () => {
  it('throws on an unknown action so typos are caught', () => {
    expect(() => can(P.Owner, 'project.destroy')).toThrow(/Unknown permission action/);
  });

  it('denies a missing principal', () => {
    expect(can(null, 'project.read')).toBe(false);
  });

  it('defines rules only for known role keys', () => {
    const keys = new Set(['Owner', 'Admin', 'PM', 'TeamMember', 'Finance', 'Contact']);
    for (const action of ACTIONS) {
      for (const k of Object.keys(RULES[action])) expect(keys.has(k), `${action}: ${k}`).toBe(true);
    }
  });
});

describe('workspace settings and users (4.2 rows 1–2)', () => {
  it('workspace settings: Owner CRUD, Admin RU; everyone reads the public fields (D-17)', () => {
    expectAllowed('workspace.read', {}, ALL);
    expectAllowed('workspace.readAdmin', {}, ['Owner', 'Admin']);
    expectAllowed('workspace.update', {}, ['Owner', 'Admin']);
    expectAllowed('workspace.delete', {}, ['Owner']);
    expectAllowed('workspace.transferOwnership', {}, ['Owner']);
  });

  it('invite: Owner/Admin any role, PM Team Members only', () => {
    expectAllowed('user.invite', { extra: { target: { role: 'TeamMember' } } }, ['Owner', 'Admin', 'PM']);
    expectAllowed('user.invite', { extra: { target: { role: 'Admin' } } }, ['Owner', 'Admin']);
    expectAllowed('user.invite', { extra: { target: { role: 'Finance' } } }, ['Owner', 'Admin']);
  });

  it('Admin cannot change, deactivate or re-rate the Owner ("CRUD not Owner")', () => {
    const owner = { extra: { target: { role: 'Owner' } } };
    expectAllowed('user.changeRole', owner, ['Owner']);
    expectAllowed('user.deactivate', owner, ['Owner']);
    expectAllowed('user.update', owner, ['Owner']);
    expectAllowed('user.updateRates', owner, ['Owner', 'Finance']);
  });

  it('role change and deactivation of others: Owner and Admin only', () => {
    const tm = { extra: { target: { role: 'TeamMember' } } };
    expectAllowed('user.changeRole', tm, ['Owner', 'Admin']);
    expectAllowed('user.deactivate', tm, ['Owner', 'Admin']);
  });

  it('rates: Owner/Admin/Finance see and set them, Team Members never see them (FR-USER-07, D-06)', () => {
    expectAllowed('user.viewRates', {}, ['Owner', 'Admin', 'Finance']);
    expectAllowed('user.updateRates', { extra: { target: { role: 'PM' } } }, ['Owner', 'Admin', 'Finance']);
  });

  it('user list: everyone internal except Team Members', () => {
    expectAllowed('user.list', {}, ['Owner', 'Admin', 'PM', 'Finance']);
  });
});

describe('clients and contacts (4.2 rows 3–4)', () => {
  it('clients: Owner/Admin CRUD, PM CRU, Finance R, Team Member name of member clients, Contact own company', () => {
    expectAllowed('client.create', {}, ['Owner', 'Admin', 'PM']);
    expectAllowed('client.update', {}, ['Owner', 'Admin', 'PM']);
    expectAllowed('client.delete', {}, ['Owner', 'Admin']);
    expectAllowed('client.read', { extra: { client: { id: CLIENT_A }, memberOfClient: true } }, ALL);
    expectAllowed('client.read', { extra: { client: { id: CLIENT_B }, memberOfClient: false } }, ['Owner', 'Admin', 'PM', 'Finance']);
    expectAllowed('client.readDetails', {}, ['Owner', 'Admin', 'PM', 'Finance']);
  });

  it('contacts and portal invites: Owner/Admin/PM CRUD, Finance R', () => {
    expectAllowed('contact.read', {}, ['Owner', 'Admin', 'PM', 'Finance']);
    for (const a of ['contact.create', 'contact.update', 'contact.delete']) expectAllowed(a, {}, ['Owner', 'Admin', 'PM']);
  });
});

describe('projects and members (4.2 rows 5–6)', () => {
  it('create: Owner/Admin/PM — TC-ROLE-003 Team Member POST /projects is denied', () => {
    expectAllowed('project.create', {}, ['Owner', 'Admin', 'PM']);
    expect(can(P.TeamMember, 'project.create', {})).toBe(false);
  });

  it('delete: Owner/Admin only — TC-ROLE-004 Team Member DELETE /projects/{A} is denied', () => {
    expectAllowed('project.delete', { member: true }, ['Owner', 'Admin']);
  });

  it('read: members, Finance, Owner/Admin; contacts only on own portal-enabled projects', () => {
    expectAllowed('project.read', { member: true }, ALL);
    expectAllowed('project.read', { member: false }, ['Owner', 'Admin', 'Finance']);
    expectAllowed('project.read', { member: true, portal: false }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
    expectAllowed('project.read', { member: true, projectClient: CLIENT_B }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
  });

  it('budgets are finance data: hidden from Team Members and contacts', () => {
    expectAllowed('project.viewFinancials', { member: true }, ['Owner', 'Admin', 'PM', 'Finance']);
  });

  it('update: Owner/Admin, PM on member projects', () => {
    expectAllowed('project.update', { member: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('project.update', { member: false }, ['Owner', 'Admin']);
  });

  it('members: PM manages own projects; others read', () => {
    // D-14: only the project's own PM manages members and portal levels
    expectAllowed('projectMember.manage', { member: true, pm: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('projectMember.manage', { member: true }, ['Owner', 'Admin']);
    expectAllowed('projectMember.manage', { member: false }, ['Owner', 'Admin']);
    expectAllowed('projectMember.read', { member: true }, ALL);
  });
});

describe('milestones and tasks (4.2 rows 7–8)', () => {
  it('milestones: contacts see Client-visible only', () => {
    expectAllowed('milestone.read', { member: true, visibility: 'Client' }, ALL);
    expectAllowed('milestone.read', { member: true, visibility: 'Internal' }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
    expectAllowed('milestone.update', { member: true }, ['Owner', 'Admin', 'PM']);
  });

  it('tasks: Team Member creates on member projects, edits own or assigned, deletes own', () => {
    expectAllowed('task.create', { member: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
    expectAllowed('task.update', { member: true, assigned: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
    expectAllowed('task.update', { member: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('task.delete', { member: true, own: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
    expectAllowed('task.delete', { member: true, assigned: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('task.read', { member: true, visibility: 'Internal' }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
  });

  it('TC-ROLE-005: a Team Member cannot change task visibility or touch tasks of a non-member project', () => {
    expect(can(P.TeamMember, 'task.changeVisibility', ctxFor(P.TeamMember, { member: true, assigned: true }))).toBe(false);
    expect(can(P.TeamMember, 'task.update', ctxFor(P.TeamMember, { member: false, assigned: true }))).toBe(false);
  });

  it('client requests: contacts with Comment level or above (FR-PORT-03, TC-PORT-004)', () => {
    expectAllowed('task.request', { member: true, level: 'Comment' }, ['Contact']);
    expectAllowed('task.request', { member: true, level: 'View' }, []);
  });
});

describe('comments and files (4.2 rows 9–10)', () => {
  it('comments: everyone internal creates on accessible projects; contacts need Comment level', () => {
    expectAllowed('comment.create', { member: true, level: 'Comment', visibility: 'Client' }, ALL);
    expectAllowed('comment.create', { member: true, level: 'View', visibility: 'Client' }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
    expectAllowed('comment.read', { member: true, visibility: 'Internal' }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
  });

  it('comments: authors edit their own; Owner/Admin may delete any (FR-COM-04)', () => {
    expectAllowed('comment.update', { member: true, own: true, visibility: 'Client' }, ALL);
    expectAllowed('comment.update', { member: true, own: false, visibility: 'Client' }, []);
    expectAllowed('comment.delete', { member: true, own: false, visibility: 'Client' }, ['Owner', 'Admin']);
  });

  it('files: Team Member uploads on member projects and deletes own; contacts upload with Comment level', () => {
    expectAllowed('file.create', { member: true, level: 'Comment' }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Contact']);
    expectAllowed('file.delete', { member: true, own: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
    expectAllowed('file.update', { member: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('file.read', { member: true, visibility: 'Client' }, ALL);
  });
});

describe('approvals (4.2 rows 11–12, BR-APP-02)', () => {
  it('requesting: Owner/Admin, PM and Team Members on member projects', () => {
    expectAllowed('approval.request', { member: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
  });

  it('deciding: only an Approve-level contact listed as approver; never internal users', () => {
    expectAllowed('approval.decide', { member: true, level: 'Approve', extra: { isApprover: true } }, ['Contact']);
    expectAllowed('approval.decide', { member: true, level: 'View', extra: { isApprover: true } }, []); // TC-APP-002
    expectAllowed('approval.decide', { member: true, level: 'Approve', extra: { isApprover: false } }, []);
  });
});

describe('time, finance, reports, activity (4.2 rows 13–19)', () => {
  it('time entries: Team Member edits own entries only while Draft or Rejected (FR-TIME-03)', () => {
    expectAllowed('timeEntry.update', { member: true, own: true, record: { user_id: undefined }, status: 'Draft' }, ['Owner', 'Admin', 'TeamMember']);
    expectAllowed('timeEntry.update', { member: true, own: true, status: 'Approved' }, ['Owner', 'Admin']);
    expectAllowed('timeEntry.read', { member: true, own: false }, ['Owner', 'Admin', 'PM', 'Finance']);
    expectAllowed('timesheet.approve', { member: true }, ['Owner', 'Admin', 'PM']);
  });

  it('D-13: a PM creates time entries for others only on projects where they are the PM', () => {
    expectAllowed('timeEntry.create', { member: true, pm: true }, ['Owner', 'Admin', 'PM']);
    expectAllowed('timeEntry.create', { member: true }, ['Owner', 'Admin']);
    expectAllowed('timeEntry.create', { member: true, own: true }, ['Owner', 'Admin', 'TeamMember']);
  });

  it('D-14: a PM requests approvals on any project they belong to', () => {
    expectAllowed('approval.request', { member: true }, ['Owner', 'Admin', 'PM', 'TeamMember']);
  });

  it('proposals and contracts: contacts read own client, accept/sign with Approve', () => {
    expectAllowed('proposal.create', {}, ['Owner', 'Admin', 'PM']);
    expectAllowed('proposal.read', {}, ['Owner', 'Admin', 'PM', 'Finance', 'Contact']);
    expectAllowed('proposal.read', { projectClient: CLIENT_B }, ['Owner', 'Admin', 'PM', 'Finance']);
    // D-16: commercial rights come from the contact's commercial_authority flag, not portal level
    const withAuthority = { ...P.Contact, commercial_authority: true };
    expect(can(withAuthority, 'proposal.accept', ctxFor(withAuthority, {}))).toBe(true);
    expect(can(withAuthority, 'contract.sign', ctxFor(withAuthority, {}))).toBe(true);
    expect(can(withAuthority, 'proposal.accept', ctxFor(withAuthority, { projectClient: CLIENT_B }))).toBe(false);
    expectAllowed('proposal.accept', { member: true, level: 'Approve' }, []); // Approve level alone is not enough
  });

  it('invoices: Finance CRUD, PM read; TC-ROLE-006 Team Member GET /invoices is denied', () => {
    expectAllowed('invoice.create', {}, ['Owner', 'Admin', 'Finance']);
    expectAllowed('invoice.read', {}, ['Owner', 'Admin', 'PM', 'Finance', 'Contact']);
    expect(can(P.TeamMember, 'invoice.read', ctxFor(P.TeamMember, {}))).toBe(false);
    const withAuthority = { ...P.Contact, commercial_authority: true };
    expect(can(withAuthority, 'invoice.pay', ctxFor(withAuthority, {}))).toBe(true);
    expectAllowed('invoice.pay', {}, []);
  });

  it('expenses: Team Member logs own on member projects; Finance CRUD', () => {
    expectAllowed('expense.create', { member: true, own: true }, ['Owner', 'Admin', 'PM', 'TeamMember', 'Finance']);
    expectAllowed('expense.update', {}, ['Owner', 'Admin', 'Finance']);
  });

  it('reports and financial cards: never Team Members or contacts (BR-DASH-03)', () => {
    expectAllowed('report.read', { member: true }, ['Owner', 'Admin', 'PM', 'Finance']);
    expectAllowed('finance.viewCards', {}, ['Owner', 'Admin', 'PM', 'Finance']);
  });

  it('activity log: Team Members see non-finance events of member projects; Finance sees finance events', () => {
    expectAllowed('activity.read', { member: true, record: { is_finance_event: false } }, ['Owner', 'Admin', 'PM', 'TeamMember']);
    expectAllowed('activity.read', { member: true, record: { is_finance_event: true } }, ['Owner', 'Admin', 'PM', 'Finance']);
  });
});
