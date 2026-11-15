// Phase 5: client portal, approvals, contact privacy.
import { z } from 'zod';
import { isoDateSchema, paginationSchema, trimmedString, uuidSchema } from './common.js';
import { COMMENT_MAX_ATTACHMENTS } from './comms.js';

// ---------------------------------------------------------------------------
// Approvals (FR-APP-01…07, BR-APP-01…03)
// ---------------------------------------------------------------------------

export const APPROVAL_RULES = Object.freeze(['Any', 'All']);
export const APPROVAL_DECISIONS = Object.freeze(['Approved', 'ChangesRequested']);
export const APPROVAL_MAX_APPROVERS = 10;

export const approvalCreateSchema = z
  .object({
    /** A Client-visible file version or task (FR-APP-01) */
    file_version_id: uuidSchema.optional(),
    task_id: uuidSchema.optional(),
    approver_contact_ids: z
      .array(uuidSchema)
      .min(1, 'Choose at least one approver')
      .max(APPROVAL_MAX_APPROVERS)
      .transform((ids) => [...new Set(ids)]),
    /** FR-APP-04: "Any one" or "All" approvers */
    rule: z.enum(APPROVAL_RULES).default('Any'),
    due_date: isoDateSchema.nullable().optional(),
    message: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Boolean(v.file_version_id) !== Boolean(v.task_id), { path: ['file_version_id'], message: 'Choose a file version or a task' });

export const approvalListQuerySchema = paginationSchema.extend({
  status: z.enum(['Pending', 'Approved', 'ChangesRequested', 'Cancelled', 'Superseded']).optional(),
  project_id: uuidSchema.optional(),
  /** FR-APP-05: every round of one file */
  file_id: uuidSchema.optional(),
  /** Only projects I manage (PM dashboard card) */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** FR-APP-03: a note is required to request changes (TC-APP-001). */
export const approvalDecisionSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision !== 'ChangesRequested' || (v.note && v.note.length > 0), { path: ['note'], message: 'Tell the team what to change' });

/** FR-APP-02: a pin at a position on a page; x and y are 0–1 (D-41). */
export const pinCreateSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  body: trimmedString(1, 2000),
});

// ---------------------------------------------------------------------------
// Portal (FR-PORT-03), contacts (FR-CON-03…05, NFR-PRIV-02)
// ---------------------------------------------------------------------------

export const CLIENT_REQUEST_LABEL = 'Client request';

export const clientRequestSchema = z.object({
  title: trimmedString(1, 255),
  description: z.string().max(50_000).nullable().optional(),
  attachment_file_ids: z.array(uuidSchema).max(COMMENT_MAX_ATTACHMENTS).optional(),
});

export const contactAnonymiseSchema = z.object({ confirm_name: z.string().trim().min(1) });

/** Events a contact can tune in the portal. Security emails are always sent. */
export const CONTACT_NOTIFICATION_EVENTS = Object.freeze(['approval_requested', 'approval_reminder', 'mentioned', 'comment_on_followed', 'followed_task_status']);
/**
 * Approval requests and reminders email by default: approvers must hear about them
 * (FR-APP-01 "approvers notified by email + portal"). Mentions follow D-35.
 */
export const CONTACT_EMAIL_BY_DEFAULT = Object.freeze(['approval_requested', 'approval_reminder', 'mentioned']);
export const DEFAULT_CONTACT_NOTIFICATION_PREFS = Object.freeze(
  Object.fromEntries(CONTACT_NOTIFICATION_EVENTS.map((e) => [e, CONTACT_EMAIL_BY_DEFAULT.includes(e) ? 'email' : 'in_app'])),
);
export const contactNotificationPrefsSchema = z
  .object(Object.fromEntries(CONTACT_NOTIFICATION_EVENTS.map((e) => [e, z.enum(['email', 'in_app', 'off'])])))
  .partial()
  .strict();

export const portalListQuerySchema = paginationSchema.extend({
  parent_id: uuidSchema.optional(),
});
