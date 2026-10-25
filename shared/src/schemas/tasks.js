// Tasks (FR-TSK-01…14, BR-TSK-01…06, D-23) and templates (FR-PRJ-02/03/12, D-26).
import { z } from 'zod';
import { PROJECT_STATUS, TASK_PRIORITY, TASK_STATUS } from '../constants.js';
import { isoDateSchema, paginationSchema, trimmedString, uuidSchema, visibilitySchema } from './common.js';

/** Statuses a task can move freely between (D-23). */
export const OPEN_TASK_STATUSES = Object.freeze([TASK_STATUS.TO_DO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.IN_REVIEW, TASK_STATUS.BLOCKED]);
export const CLOSED_TASK_STATUSES = Object.freeze([TASK_STATUS.DONE, TASK_STATUS.CANCELLED]);

/**
 * D-23 task status rules. Returns 'move', 'reopen' (PM/Admin/Owner only) or null
 * when the change is not allowed.
 */
export function taskTransition(from, to) {
  if (from === to) return null;
  const fromOpen = OPEN_TASK_STATUSES.includes(from);
  if (fromOpen && OPEN_TASK_STATUSES.includes(to)) return 'move';
  if (fromOpen && to === TASK_STATUS.DONE && from !== TASK_STATUS.BLOCKED) return 'move';
  if (fromOpen && to === TASK_STATUS.CANCELLED) return 'move';
  if (CLOSED_TASK_STATUSES.includes(from) && to === TASK_STATUS.TO_DO) return 'reopen';
  return null;
}

/** Statuses a task may be moved to from `from` (for menus and the board). */
export function allowedTaskTargets(from) {
  return Object.values(TASK_STATUS).filter((to) => taskTransition(from, to));
}

/** Projects whose tasks can still change (BRD 16.1: closed projects have no open work). */
export const TASK_EDITABLE_PROJECT_STATUSES = Object.freeze([PROJECT_STATUS.NOT_STARTED, PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.ON_HOLD]);

export const TASK_LABEL_MAX = 10;
const labelSchema = z.string().trim().min(1).max(30);
const labelsSchema = z
  .array(labelSchema)
  .max(TASK_LABEL_MAX, `Use at most ${TASK_LABEL_MAX} labels`)
  .transform((labels) => [...new Set(labels)]);

/** FR-TSK-02: hours in 0.25 steps, stored as minutes. */
const estimateSchema = z
  .number()
  .int()
  .min(0)
  .max(100_000)
  .refine((m) => m % 15 === 0, 'Use quarter-hour steps (0.25 h)')
  .nullable();

const DUE_BEFORE_START = 'Due date cannot be before start date'; // BR-TSK-01
const datesInOrder = (v) => !v.start_date || !v.due_date || v.due_date >= v.start_date;

const taskFields = {
  title: trimmedString(1, 255),
  /** Rich text; cleaned on the server (NFR-SEC-02) */
  description: z.string().max(50_000).nullable(),
  milestone_id: uuidSchema.nullable(),
  assignee_ids: z
    .array(uuidSchema)
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  start_date: isoDateSchema.nullable(),
  due_date: isoDateSchema.nullable(),
  estimate_minutes: estimateSchema,
  priority: z.enum(Object.values(TASK_PRIORITY)),
  visibility: visibilitySchema,
  labels: labelsSchema,
  is_billable: z.boolean().nullable(),
};

export const taskCreateSchema = z
  .object({ ...taskFields, parent_task_id: uuidSchema.optional() })
  .partial()
  .required({ title: true })
  .refine(datesInOrder, { path: ['due_date'], message: DUE_BEFORE_START });

export const taskUpdateSchema = z
  .object({ ...taskFields, version: z.number().int().positive(), apply_to_subtasks: z.boolean() })
  .partial()
  .required({ version: true })
  .refine(datesInOrder, { path: ['due_date'], message: DUE_BEFORE_START });

/** Every field PATCH /tasks/:id understands (used by authorizeFields). */
export const TASK_UPDATE_FIELDS = Object.freeze([...Object.keys(taskFields), 'version', 'apply_to_subtasks']);

export const taskStatusSchema = z.object({
  status: z.enum(Object.values(TASK_STATUS)),
  version: z.number().int().positive(),
  /** BR-TSK-02 "Complete all subtasks" */
  complete_subtasks: z.boolean().optional(),
});

/** FR-TSK-12: place the task right after `after_id` among its siblings (null = first). */
export const taskPositionSchema = z.object({ after_id: uuidSchema.nullable() });

export const taskMoveSchema = z.object({ project_id: uuidSchema });

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const taskListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(Object.values(TASK_STATUS)).optional(),
  /** a user id, "me" or "none" */
  assignee: z.union([uuidSchema, z.enum(['me', 'none'])]).optional(),
  /** a milestone id or "none" */
  milestone: z.union([uuidSchema, z.enum(['none'])]).optional(),
  label: z.string().trim().max(30).optional(),
  due_from: isoDateSchema.optional(),
  due_to: isoDateSchema.optional(),
  overdue: flag,
  /** list a task's subtasks; without it only top-level tasks are listed */
  parent_task_id: uuidSchema.optional(),
  /** include subtasks in the result (calendar) */
  all_levels: flag,
});

export const checklistItemCreateSchema = z.object({ text: trimmedString(1, 500) });
export const checklistItemUpdateSchema = z
  .object({ text: trimmedString(1, 500), is_done: z.boolean(), version: z.number().int().positive() })
  .partial()
  .required({ version: true });

export const dependencyCreateSchema = z.object({ predecessor_id: uuidSchema });

export const BULK_TASK_ACTIONS = Object.freeze(['status', 'assign', 'unassign', 'due_date', 'delete']);

/** FR-TSK-11 */
export const taskBulkSchema = z
  .object({
    task_ids: z
      .array(uuidSchema)
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)]),
    action: z.enum(BULK_TASK_ACTIONS),
    status: z.enum(Object.values(TASK_STATUS)).optional(),
    user_id: uuidSchema.optional(),
    due_date: isoDateSchema.nullable().optional(),
  })
  .refine((v) => v.action !== 'status' || v.status, { path: ['status'], message: 'Choose a status' })
  .refine((v) => !['assign', 'unassign'].includes(v.action) || v.user_id, { path: ['user_id'], message: 'Choose a person' })
  .refine((v) => v.action !== 'due_date' || v.due_date !== undefined, { path: ['due_date'], message: 'Choose a date or clear it' });

// ---------------------------------------------------------------------------
// Templates (D-26)
// ---------------------------------------------------------------------------

export const templateCreateSchema = z.object({
  project_id: uuidSchema,
  name: trimmedString(2, 150),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const templateUpdateSchema = z
  .object({ name: trimmedString(2, 150), description: z.string().trim().max(2000).nullable(), version: z.number().int().positive() })
  .partial()
  .required({ version: true });

/** FR-PRJ-12: duplicate a project's structure under a new name. */
export const projectDuplicateSchema = z.object({
  name: trimmedString(2, 150),
  start_date: isoDateSchema.optional(),
});
