// The permission matrix of BRD section 4.2, as data.
//
// RULES[action][roleKey] is either `true` (always allowed for that role) or a
// predicate (principal, ctx) => boolean for scoped rules ("member", "own",
// "Client-visible"). A missing role key means no access.
//
// roleKey is the internal role (Owner, Admin, PM, TeamMember, Finance) or
// 'Contact' for client contacts.
//
// ctx is filled by the route's loader with whatever the rule needs:
//   ctx.membership  the principal's ProjectMember row on the project (or null)
//   ctx.project     { client_id, portal_enabled }
//   ctx.record      the item acted on: { visibility, created_by | author_id | user_id,
//                   assignee_ids, status, client_id, is_finance_event }
//   ctx.target      the user being managed (users module)
//   ctx.client      { id } for client records
//   ctx.memberOfClient       Team Member belongs to a project of this client
//   ctx.isApprover           contact is listed on the approval request
//   ctx.project.pm_user_id   the project's PM (for "project's PM only" rules)
//
// Contacts' commercial rights come from principal.commercial_authority (D-16),
// not from their project portal level.
//
// Business rules that are not permissions (e.g. "last administrator", "status
// must be Draft") live in the services and return 409/422.
//
// Deviations from the matrix, each recorded in docs/DECISIONS.md:
//   D-06 Finance may update user rates (FR-USER-07 over the matrix "—").
//   D-13 PM may create time entries for members only as the project's PM (FR-TIME-08).
//   D-14 PM requests approvals on member projects; manages members only as the project's PM.
//   D-16 Accept / sign / pay need the contact's commercial_authority flag.
import { PORTAL_LEVEL_ORDER, ROLES, TIME_ENTRY_STATUS, VISIBILITY } from '@cpm/shared';

export const CONTACT = 'Contact';
const { OWNER, ADMIN, PM, TEAM_MEMBER, FINANCE } = ROLES;

// ---- predicates -------------------------------------------------------------

const and =
  (...preds) =>
  (p, c) =>
    preds.every((f) => f(p, c));
const or =
  (...preds) =>
  (p, c) =>
    preds.some((f) => f(p, c));

const isMember = (_p, c) => Boolean(c.membership);
/** The principal is this project's PM (projects.pm_user_id). */
const isProjectPm = (p, c) => Boolean(c.project) && c.project.pm_user_id === p.id;
const ownerIdOf = (r) => r?.author_id ?? r?.user_id ?? r?.created_by ?? null;
const isOwn = (p, c) => ownerIdOf(c.record) === p.id;
const isAssigned = (p, c) => Array.isArray(c.record?.assignee_ids) && c.record.assignee_ids.includes(p.id);

const portalLevelAtLeast = (level) => (_p, c) =>
  PORTAL_LEVEL_ORDER.indexOf(c.membership?.portal_level) >= PORTAL_LEVEL_ORDER.indexOf(level);

/** Contact is on this project of their own client, and the portal is on (BR-CLI-01, FR-PORT-08). */
const contactOnProject = (p, c) =>
  Boolean(c.project) &&
  c.project.client_id === p.client_id &&
  c.project.portal_enabled === true &&
  Boolean(c.membership) &&
  c.membership.contact_id === p.id;

const clientVisible = (_p, c) => c.record?.visibility === VISIBILITY.CLIENT;
const contactSeesRecord = and(contactOnProject, clientVisible);
const contactCanComment = and(contactOnProject, portalLevelAtLeast('Comment'));
const ownClientRecord = (p, c) => Boolean(c.record) && c.record.client_id === p.client_id;
const hasCommercialAuthority = (p) => p.commercial_authority === true; // D-16

const targetIsNotOwner = (_p, c) => Boolean(c.target) && c.target.role !== OWNER;
const targetIsTeamMember = (_p, c) => c.target?.role === TEAM_MEMBER;
const timeEntryEditable = (p, c) =>
  isOwn(p, c) && [TIME_ENTRY_STATUS.DRAFT, TIME_ENTRY_STATUS.REJECTED].includes(c.record?.status);

const ALL_INTERNAL = { [OWNER]: true, [ADMIN]: true, [PM]: true, [TEAM_MEMBER]: true, [FINANCE]: true };
const OWNER_ADMIN = { [OWNER]: true, [ADMIN]: true };

// ---- the matrix ---------------------------------------------------------------

export const RULES = {
  // Workspace settings, branding
  // D-17: everyone signed in reads the public branding/locale fields
  'workspace.read': { ...ALL_INTERNAL, [CONTACT]: true },
  'workspace.readAdmin': { ...OWNER_ADMIN }, // numbering, currency lock
  'workspace.update': { ...OWNER_ADMIN },
  'workspace.delete': { [OWNER]: true }, // BR-USER-04, also billing plan
  'workspace.transferOwnership': { [OWNER]: true }, // BR-ROLE-01

  // Users: invite, change role, deactivate
  'user.list': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true },
  'user.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true },
  'user.viewRates': { ...OWNER_ADMIN, [FINANCE]: true }, // FR-USER-07
  'user.invite': { [OWNER]: targetIsNotOwner, [ADMIN]: targetIsNotOwner, [PM]: targetIsTeamMember },
  'user.manageInvitation': { [OWNER]: targetIsNotOwner, [ADMIN]: targetIsNotOwner, [PM]: targetIsTeamMember },
  'user.update': { [OWNER]: true, [ADMIN]: targetIsNotOwner }, // name, capacity
  'user.changeRole': { [OWNER]: true, [ADMIN]: targetIsNotOwner },
  'user.updateRates': { [OWNER]: true, [ADMIN]: targetIsNotOwner, [FINANCE]: true }, // D-06
  'user.deactivate': { [OWNER]: true, [ADMIN]: targetIsNotOwner },

  // Clients
  'client.list': { ...ALL_INTERNAL }, // rows scoped by auth/scopes.js; contacts use /auth/me
  'client.create': { ...OWNER_ADMIN, [PM]: true },
  'client.read': {
    ...OWNER_ADMIN,
    [PM]: true,
    [FINANCE]: true,
    [TEAM_MEMBER]: (_p, c) => c.memberOfClient === true, // name only
    [CONTACT]: (p, c) => c.client?.id === p.client_id, // own company profile
  },
  'client.readDetails': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true }, // incl. internal notes (FR-CLI-08)
  'client.update': { ...OWNER_ADMIN, [PM]: true },
  'client.delete': { ...OWNER_ADMIN },

  // Client contacts / portal invites
  'contact.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true },
  'contact.create': { ...OWNER_ADMIN, [PM]: true },
  'contact.update': { ...OWNER_ADMIN, [PM]: true },
  'contact.delete': { ...OWNER_ADMIN, [PM]: true },

  // Projects
  'project.list': { ...ALL_INTERNAL, [CONTACT]: true }, // rows scoped by auth/scopes.js
  'project.create': { ...OWNER_ADMIN, [PM]: true },
  'project.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactOnProject,
  },
  'project.update': { ...OWNER_ADMIN, [PM]: isMember }, // incl. status changes (BRD 16.1)
  // Budget amounts are finance data: never for Team Members or contacts (persona Omar, BR-DASH-03)
  'project.viewFinancials': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true },
  'project.delete': { ...OWNER_ADMIN },

  // Project members
  'projectMember.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactOnProject, // names only
  },
  'projectMember.manage': { ...OWNER_ADMIN, [PM]: isProjectPm }, // D-14: add/remove, portal levels

  // Milestones
  'milestone.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactSeesRecord,
  },
  'milestone.create': { ...OWNER_ADMIN, [PM]: isMember },
  'milestone.update': { ...OWNER_ADMIN, [PM]: isMember },
  'milestone.delete': { ...OWNER_ADMIN, [PM]: isMember },

  // Tasks
  'task.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactSeesRecord,
  },
  'task.create': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember },
  'task.request': { [CONTACT]: contactCanComment }, // FR-PORT-03 client request
  'task.update': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, or(isOwn, isAssigned)) },
  'task.delete': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, isOwn) },
  'task.changeVisibility': { ...OWNER_ADMIN, [PM]: isMember }, // FR-TSK-14, BR-TSK-05
  // D-24 field groups. "Work" = status, checklist, description, estimate (assigned or own);
  // "details" = title, priority, dates, labels (own tasks only for Team Members).
  'task.editWork': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, or(isOwn, isAssigned)) },
  'task.editDetails': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, isOwn) },
  'task.changeMilestone': { ...OWNER_ADMIN, [PM]: isMember },
  'task.changeBillable': { ...OWNER_ADMIN, [PM]: isMember },
  'task.assignOthers': { ...OWNER_ADMIN, [PM]: isMember }, // D-24: only PM/Admin/Owner reassign
  'task.assignSelf': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember }, // D-24
  'task.reopen': { ...OWNER_ADMIN, [PM]: isMember }, // D-23: Done/Cancelled → To Do
  'task.move': { ...OWNER_ADMIN, [PM]: isMember }, // BR-TSK-04, D-27
  'task.manageDependencies': { ...OWNER_ADMIN, [PM]: isMember }, // FR-TSK-07

  // Project templates (FR-PRJ-02/03, D-26)
  'template.list': { ...OWNER_ADMIN, [PM]: true },
  'template.save': { ...OWNER_ADMIN, [PM]: isMember }, // from a project they belong to
  'template.manage': { ...OWNER_ADMIN, [PM]: true }, // rename, delete
  'project.duplicate': { ...OWNER_ADMIN, [PM]: isMember }, // FR-PRJ-12

  // Comments (on projects, tasks, files, approvals)
  'comment.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactSeesRecord,
  },
  'comment.create': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactCanComment,
  },
  'comment.update': {
    [OWNER]: isOwn,
    [ADMIN]: isOwn,
    [PM]: isOwn,
    [TEAM_MEMBER]: isOwn,
    [FINANCE]: isOwn,
    [CONTACT]: and(contactSeesRecord, isOwn),
  },
  'comment.delete': {
    ...OWNER_ADMIN, // FR-COM-04: Admin can delete any
    [PM]: isOwn,
    [TEAM_MEMBER]: isOwn,
    [FINANCE]: isOwn,
    [CONTACT]: and(contactSeesRecord, isOwn),
  },

  // Files
  'file.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: isMember,
    [FINANCE]: true,
    [CONTACT]: contactSeesRecord,
  },
  'file.create': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember, [CONTACT]: contactCanComment },
  'file.update': { ...OWNER_ADMIN, [PM]: isMember }, // rename, visibility (FR-FILE-07)
  'file.delete': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, isOwn) },

  // Approvals
  'approval.request': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember }, // D-14
  'approval.read': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember, [FINANCE]: true, [CONTACT]: contactSeesRecord },
  'approval.cancel': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, isOwn) }, // FR-APP-06: requester or PM
  'approval.pin': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isMember, [CONTACT]: and(contactOnProject, portalLevelAtLeast('Approve'), (_p, c) => c.isApprover === true) }, // FR-APP-02
  // Contacts (FR-CON-03…05, NFR-PRIV-02)
  'contact.portalAccess': { ...OWNER_ADMIN, [PM]: true }, // invite, revoke, restore
  'contact.privacy': { ...OWNER_ADMIN }, // export, anonymise
  'approval.decide': {
    [CONTACT]: and(contactOnProject, portalLevelAtLeast('Approve'), (_p, c) => c.isApprover === true),
  }, // BR-APP-02: internal users never decide

  // Time entries and timesheets
  'timeEntry.read': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: isOwn, [FINANCE]: true },
  'timeEntry.create': { ...OWNER_ADMIN, [PM]: isProjectPm, [TEAM_MEMBER]: and(isMember, isOwn) }, // D-13
  'timeEntry.update': { ...OWNER_ADMIN, [TEAM_MEMBER]: timeEntryEditable },
  'timeEntry.delete': { ...OWNER_ADMIN, [TEAM_MEMBER]: timeEntryEditable },
  'timesheet.approve': { ...OWNER_ADMIN, [PM]: isMember }, // FR-TIME-05

  // Proposals and contracts
  'proposal.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true, [CONTACT]: ownClientRecord },
  'proposal.create': { ...OWNER_ADMIN, [PM]: true },
  'proposal.update': { ...OWNER_ADMIN, [PM]: true },
  'proposal.delete': { ...OWNER_ADMIN, [PM]: true },
  'proposal.accept': { [CONTACT]: and(ownClientRecord, hasCommercialAuthority) },
  'contract.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true, [CONTACT]: ownClientRecord },
  'contract.create': { ...OWNER_ADMIN, [PM]: true },
  'contract.update': { ...OWNER_ADMIN, [PM]: true },
  'contract.delete': { ...OWNER_ADMIN, [PM]: true },
  'contract.sign': { ...OWNER_ADMIN, [PM]: true, [CONTACT]: and(ownClientRecord, hasCommercialAuthority) },

  // Invoices and payments
  'invoice.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true, [CONTACT]: ownClientRecord },
  'invoice.create': { ...OWNER_ADMIN, [FINANCE]: true },
  'invoice.update': { ...OWNER_ADMIN, [FINANCE]: true },
  'invoice.delete': { ...OWNER_ADMIN, [FINANCE]: true },
  'invoice.pay': { [CONTACT]: and(ownClientRecord, hasCommercialAuthority) },
  'payment.read': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true, [CONTACT]: ownClientRecord },
  'payment.create': { ...OWNER_ADMIN, [FINANCE]: true },
  'payment.update': { ...OWNER_ADMIN, [FINANCE]: true },
  'payment.delete': { ...OWNER_ADMIN, [FINANCE]: true },

  // Expenses
  'expense.read': { ...OWNER_ADMIN, [PM]: true, [TEAM_MEMBER]: isOwn, [FINANCE]: true },
  'expense.create': { ...OWNER_ADMIN, [PM]: isMember, [TEAM_MEMBER]: and(isMember, isOwn), [FINANCE]: true },
  'expense.update': { ...OWNER_ADMIN, [FINANCE]: true },
  'expense.delete': { ...OWNER_ADMIN, [FINANCE]: true },

  // Reports (profitability, utilisation) and financial dashboard cards (BR-DASH-03)
  'report.read': { ...OWNER_ADMIN, [PM]: isMember, [FINANCE]: true },
  'finance.viewCards': { ...OWNER_ADMIN, [PM]: true, [FINANCE]: true },

  // Activity / audit log
  'activity.read': {
    ...OWNER_ADMIN,
    [PM]: isMember,
    [TEAM_MEMBER]: and(isMember, (_p, c) => c.record?.is_finance_event !== true),
    [FINANCE]: (_p, c) => c.record?.is_finance_event === true,
  },
  'audit.readAll': { ...OWNER_ADMIN }, // FR-ACT-02 admin view

  // Things every internal user may do on their own account
  'self.internalApp': { ...ALL_INTERNAL },
  'self.portal': { [CONTACT]: true },
};

export const ACTIONS = Object.freeze(Object.keys(RULES));
