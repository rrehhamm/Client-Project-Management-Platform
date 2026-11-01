// FR-PRJ-01…11, FR-MS-01…03 request schemas and the project lifecycle (BRD 16.1).
import { z } from 'zod';
import { BILLING_TYPE, MILESTONE_STATUS, PORTAL_LEVELS, PROJECT_STATUS } from '../constants.js';
import { optionalText } from './clients.js';
import { isoDateSchema, paginationSchema, trimmedString, uuidSchema, visibilitySchema } from './common.js';

/** Allowed status changes (BRD 16.1). Anything else → 409 "Transition not allowed". */
export const PROJECT_TRANSITIONS = Object.freeze({
  [PROJECT_STATUS.NOT_STARTED]: Object.freeze([PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.CANCELLED]),
  [PROJECT_STATUS.IN_PROGRESS]: Object.freeze([PROJECT_STATUS.ON_HOLD, PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED]),
  [PROJECT_STATUS.ON_HOLD]: Object.freeze([PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.CANCELLED]),
  [PROJECT_STATUS.COMPLETED]: Object.freeze([PROJECT_STATUS.IN_PROGRESS]), // reopen
  [PROJECT_STATUS.CANCELLED]: Object.freeze([]),
});

/** Archived is a flag on closed projects only (BRD 16.1). */
export const ARCHIVABLE_STATUSES = Object.freeze([PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED]);

const DUE_BEFORE_START = 'Due date cannot be before start date'; // BR-PRJ-02

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const projectFields = {
  client_id: uuidSchema,
  name: trimmedString(2, 150),
  description: optionalText(10_000),
  start_date: isoDateSchema,
  due_date: isoDateSchema.nullable(),
  billing_type: z.enum(Object.values(BILLING_TYPE)),
  pm_user_id: uuidSchema,
  /** Minor units of the client currency */
  budget_amount: money.nullable(),
  budget_minutes: z.number().int().min(0).max(10_000_000).nullable(),
  portal_enabled: z.boolean(),
  close_task_on_approval: z.boolean(),
};

/** FR-PRJ-02: create from a template (create only) */
const templateIdField = { template_id: uuidSchema };

const datesInOrder = (v) => !v.start_date || !v.due_date || v.due_date >= v.start_date;

export const projectCreateSchema = z
  .object({ ...projectFields, ...templateIdField })
  .partial()
  .required({ client_id: true, name: true, start_date: true, billing_type: true, pm_user_id: true })
  .refine(datesInOrder, { path: ['due_date'], message: DUE_BEFORE_START });

export const projectUpdateSchema = z
  .object({ ...projectFields, version: z.number().int().positive() })
  .partial()
  .required({ version: true })
  .refine(datesInOrder, { path: ['due_date'], message: DUE_BEFORE_START });

export const PROJECT_UPDATE_FIELDS = Object.freeze([...Object.keys(projectFields), 'version']);

export const projectStatusSchema = z.object({
  status: z.enum(Object.values(PROJECT_STATUS)),
  version: z.number().int().positive(),
});

export const projectDeleteSchema = z.object({ confirm_name: z.string().max(200) });

export const PROJECT_SORTS = Object.freeze(['name', 'code', 'status', 'start_date', 'due_date', 'created_at']);

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const projectListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  client_id: uuidSchema.optional(),
  status: z.enum(Object.values(PROJECT_STATUS)).optional(),
  pm_user_id: uuidSchema.optional(),
  member_id: uuidSchema.optional(),
  due_from: isoDateSchema.optional(),
  due_to: isoDateSchema.optional(),
  overdue: flag,
  /** D-36 active projects (dashboard card, client list column) */
  active: flag,
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  /** Owner/Admin: the 30-day trash (FR-PRJ-11) */
  deleted: flag,
  sort: z.enum(PROJECT_SORTS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const memberAddSchema = z
  .object({
    user_id: uuidSchema.optional(),
    contact_id: uuidSchema.optional(),
    portal_level: z.enum(Object.values(PORTAL_LEVELS)).optional(),
  })
  .refine((v) => Boolean(v.user_id) !== Boolean(v.contact_id), { message: 'Give either user_id or contact_id' })
  .refine((v) => !v.user_id || !v.portal_level, { path: ['portal_level'], message: 'Portal level is only for client contacts' });

export const memberUpdateSchema = z.object({ portal_level: z.enum(Object.values(PORTAL_LEVELS)) });

const milestoneFields = {
  title: trimmedString(1, 255),
  description: optionalText(10_000),
  due_date: isoDateSchema,
  /** FR-MS-04 milestone billing (Fixed projects), minor units of the client currency */
  amount: money.nullable(),
  visibility: visibilitySchema,
  /** BR-PRJ-06: confirm saving when milestone amounts exceed the budget */
  confirm_over_budget: z.boolean(),
};

export const milestoneCreateSchema = z.object(milestoneFields).partial().required({ title: true, due_date: true });

/** Upcoming ↔ In Progress here; Completed only via /complete (FR-MS-03). */
export const MILESTONE_EDITABLE_STATUSES = Object.freeze([MILESTONE_STATUS.UPCOMING, MILESTONE_STATUS.IN_PROGRESS]);

export const milestoneUpdateSchema = z
  .object({
    ...milestoneFields,
    status: z.enum(MILESTONE_EDITABLE_STATUSES),
    version: z.number().int().positive(),
  })
  .partial()
  .required({ version: true });

export const milestoneOrderSchema = z.object({
  ids: z
    .array(uuidSchema)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Each milestone may appear only once'),
});
