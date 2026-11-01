// Enum values used by the API, the database (Prisma enums) and the UI.
// Keep these in sync with server/prisma/schema.prisma.

/** Internal workspace roles (BRD 4.1). Client Contacts are a separate table, not a role. */
export const ROLES = Object.freeze({
  OWNER: 'Owner',
  ADMIN: 'Admin',
  PM: 'PM',
  TEAM_MEMBER: 'TeamMember',
  FINANCE: 'Finance',
});

/** Who performed an action: an internal user, a client contact, or a scheduled job. */
export const ACTOR_TYPES = Object.freeze({ USER: 'User', CONTACT: 'Contact', SYSTEM: 'System' });

/** Client Contact permission ladder per project (BRD 4.1). Order matters: each level includes the previous. */
export const PORTAL_LEVELS = Object.freeze({ VIEW: 'View', COMMENT: 'Comment', APPROVE: 'Approve' });
export const PORTAL_LEVEL_ORDER = Object.freeze(['View', 'Comment', 'Approve']);

export const VISIBILITY = Object.freeze({ INTERNAL: 'Internal', CLIENT: 'Client' });

export const USER_STATUS = Object.freeze({ INVITED: 'Invited', ACTIVE: 'Active', DEACTIVATED: 'Deactivated' });
export const CONTACT_STATUS = Object.freeze({ NOT_INVITED: 'NotInvited', INVITED: 'Invited', ACTIVE: 'Active' });
export const CLIENT_STATUS = Object.freeze({ LEAD: 'Lead', ACTIVE: 'Active', INACTIVE: 'Inactive', ARCHIVED: 'Archived' });

export const PROJECT_STATUS = Object.freeze({
  NOT_STARTED: 'NotStarted',
  IN_PROGRESS: 'InProgress',
  ON_HOLD: 'OnHold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
});
/** D-36: an "active" project is Not Started, In Progress or On Hold (and neither archived nor deleted). */
export const ACTIVE_PROJECT_STATUSES = Object.freeze([PROJECT_STATUS.NOT_STARTED, PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.ON_HOLD]);
export const BILLING_TYPE = Object.freeze({ FIXED: 'Fixed', HOURLY: 'Hourly', RETAINER: 'Retainer', NON_BILLABLE: 'NonBillable' });
export const PROJECT_ROLE = Object.freeze({ PM: 'PM', MEMBER: 'Member' });

export const MILESTONE_STATUS = Object.freeze({
  UPCOMING: 'Upcoming',
  IN_PROGRESS: 'InProgress',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
});

export const TASK_STATUS = Object.freeze({
  TO_DO: 'ToDo',
  IN_PROGRESS: 'InProgress',
  IN_REVIEW: 'InReview',
  DONE: 'Done',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled',
});
export const TASK_PRIORITY = Object.freeze({ LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' });

export const APPROVAL_STATUS = Object.freeze({
  PENDING: 'Pending',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'ChangesRequested',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Superseded',
});

export const TIME_ENTRY_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  INVOICED: 'Invoiced',
});

export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIALLY_PAID: 'PartiallyPaid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
});

/**
 * Supported currencies (OD-09) with their ISO 4217 minor-unit exponent.
 * Amounts are stored as integers in minor units and rounded to these
 * decimals (agreed correction to FR-INV-02: JOD uses 3, not 2).
 */
export const CURRENCIES = Object.freeze({
  JOD: Object.freeze({ code: 'JOD', decimals: 3 }),
  USD: Object.freeze({ code: 'USD', decimals: 2 }),
  EUR: Object.freeze({ code: 'EUR', decimals: 2 }),
});
export const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));

/** NFR-PERF-03 */
export const PAGINATION = Object.freeze({ DEFAULT_PAGE_SIZE: 25, MAX_PAGE_SIZE: 100 });
