// Phase 4: comments, notifications, files, audit log, dashboard and search.
import { z } from 'zod';
import { isoDateSchema, paginationSchema, trimmedString, uuidSchema, visibilitySchema } from './common.js';

// ---------------------------------------------------------------------------
// Comments (FR-COM-01…04, FR-COM-06)
// ---------------------------------------------------------------------------

export const COMMENT_ENTITY_TYPES = Object.freeze(['Project', 'Task', 'File']);
export const COMMENT_MAX_CHARS = 10_000; // visible text, FR-COM-01
export const COMMENT_MAX_ATTACHMENTS = 5;
export const COMMENT_EDIT_WINDOW_HOURS = 24; // D-34 (a)

export const commentListQuerySchema = paginationSchema.extend({
  entity_type: z.enum(COMMENT_ENTITY_TYPES),
  entity_id: uuidSchema,
  /** Message board: replies to one post */
  parent_id: uuidSchema.optional(),
});

export const commentCreateSchema = z.object({
  entity_type: z.enum(COMMENT_ENTITY_TYPES),
  entity_id: uuidSchema,
  /** Rich text; cleaned on the server. Length is checked on the visible text. */
  body: z.string().min(1).max(100_000),
  visibility: visibilitySchema.optional(),
  mention_user_ids: z.array(uuidSchema).max(50).optional(),
  /** FR-COM-03: contacts can be mentioned only in Client-visible comments */
  mention_contact_ids: z.array(uuidSchema).max(20).optional(),
  attachment_file_ids: z.array(uuidSchema).max(COMMENT_MAX_ATTACHMENTS).optional(),
  /** FR-COM-06: reply to a message-board post (project comments only) */
  parent_id: uuidSchema.optional(),
});

export const commentUpdateSchema = z.object({
  body: z.string().min(1).max(100_000),
  mention_user_ids: z.array(uuidSchema).max(50).optional(),
  version: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Notifications (FR-NOT-01…03, FR-NOT-05)
// ---------------------------------------------------------------------------

/** Events a user can tune. Security emails are not listed: they cannot be turned off. */
export const NOTIFICATION_EVENTS = Object.freeze([
  'task_assigned',
  'mentioned',
  'comment_on_followed',
  'followed_task_status',
  'task_due_tomorrow',
  'project_status',
  'approval_decided', // Phase 5: a client decided on an approval you requested or manage
  'client_request', // Phase 5: a client sent a request on your project
]);
/** email = in-app and email; in_app = in-app only; off = nothing */
export const NOTIFICATION_CHANNELS = Object.freeze(['email', 'in_app', 'off']);
/** D-35: only these events email by default; every other event is in-app only. Security emails are always sent. */
export const EMAIL_BY_DEFAULT = Object.freeze(['task_assigned', 'mentioned', 'task_due_tomorrow']);
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze(Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, EMAIL_BY_DEFAULT.includes(e) ? 'email' : 'in_app'])));

export const notificationPrefsSchema = z
  .object(Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, z.enum(NOTIFICATION_CHANNELS)])))
  .partial()
  .strict();

export const notificationListQuerySchema = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const FOLLOW_ENTITY_TYPES = Object.freeze(['Task', 'File', 'Project']);
export const followSchema = z.object({ entity_type: z.enum(FOLLOW_ENTITY_TYPES), entity_id: uuidSchema });

// ---------------------------------------------------------------------------
// Files (FR-FILE-01…07, BR-FILE-01/03)
// ---------------------------------------------------------------------------

export const FILE_MAX_BYTES_DEFAULT = 104_857_600; // 100 MB, OD-07
export const WORKSPACE_QUOTA_BYTES_DEFAULT = 53_687_091_200; // 50 GB, OD-07

/**
 * Allowed extensions → the content type expected from the file's bytes (BR-FILE-01).
 * "text" and "svg" have no magic bytes; the server checks them as text.
 */
export const FILE_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
  txt: 'text/plain',
});
/** Shown inline in the browser (FR-FILE-03). SVG is download-only (D-34 c). */
export const PREVIEWABLE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

export const fileExtension = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
};

const fileName = trimmedString(1, 255).refine((v) => !/[\\/\p{Cc}]/u.test(v), { message: 'File names cannot contain slashes or control characters' });

export const fileUploadQuerySchema = z.object({
  folder_id: uuidSchema.optional(),
  task_id: uuidSchema.optional(),
  visibility: visibilitySchema.optional(),
});
export const fileUploadNameSchema = fileName;

export const fileListQuerySchema = paginationSchema.extend({
  folder: z.union([uuidSchema, z.literal('root')]).optional(),
  task_id: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const fileUpdateSchema = z
  .object({
    name: fileName,
    visibility: visibilitySchema,
    folder_id: uuidSchema.nullable(),
    task_id: uuidSchema.nullable(),
    version: z.number().int().positive(),
  })
  .partial()
  .required({ version: true });
export const FILE_UPDATE_FIELDS = Object.freeze(['name', 'visibility', 'folder_id', 'task_id', 'version']);

export const folderCreateSchema = z.object({ name: trimmedString(1, 100) });
export const folderUpdateSchema = z.object({ name: trimmedString(1, 100), version: z.number().int().positive() });

export const downloadQuerySchema = z.object({
  inline: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ---------------------------------------------------------------------------
// Audit log (FR-ACT-02), dashboard drill-down (FR-DASH-05), search (FR-SRCH-01)
// ---------------------------------------------------------------------------

export const auditQuerySchema = paginationSchema.extend({
  actor_id: uuidSchema.optional(),
  entity_type: z.string().trim().max(40).optional(),
  action: z.string().trim().max(80).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const workTaskQuerySchema = paginationSchema.extend({
  /** this_week uses the workspace week start and timezone (BR-DASH-02) */
  due: z.enum(['this_week', 'overdue']).optional(),
  status: z.enum(['ToDo', 'InProgress', 'InReview', 'Done', 'Blocked', 'Cancelled']).optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  inactive_assignee: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Only projects I manage (PM dashboard) */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_LIMIT = 20;
export const searchQuerySchema = z.object({ q: z.string().trim().min(SEARCH_MIN_CHARS, 'Type at least 2 characters').max(100) });
