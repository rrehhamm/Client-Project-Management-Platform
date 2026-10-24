// Request schemas for internal user management (FR-USER-01…07).
import { z } from 'zod';
import { ROLES, USER_STATUS } from '../constants.js';
import { emailSchema, paginationSchema, trimmedString } from './common.js';

/** Roles that can be given by invite or role change. Owner only moves by transfer (BR-ROLE-01). */
export const ASSIGNABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.PM, ROLES.TEAM_MEMBER, ROLES.FINANCE]);

export const inviteUserSchema = z.object({
  email: emailSchema,
  full_name: trimmedString(1, 120),
  role: z.enum(ASSIGNABLE_ROLES),
});

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const userListQuerySchema = paginationSchema.extend({
  role: z.enum(Object.values(ROLES)).optional(),
  status: z.enum(Object.values(USER_STATUS)).optional(),
  q: z.string().trim().max(100).optional(),
  /** Only active users who can be assigned work (FR-USER-05) */
  assignable: booleanFlag,
});

/** Integer minor units of the workspace currency (DECISIONS.md D-04). */
const rateSchema = z.number().int().min(0).max(1_000_000_000).nullable();

/**
 * Every field PATCH /users/:id understands. Which of them a caller may set
 * depends on their role (server/src/modules/users/fields.js).
 */
export const userUpdateSchema = z
  .object({
    full_name: trimmedString(1, 120),
    role: z.enum(ASSIGNABLE_ROLES),
    capacity_minutes_per_week: z.number().int().min(0).max(168 * 60),
    hourly_cost_rate: rateSchema,
    default_bill_rate: rateSchema,
    version: z.number().int().positive(),
  })
  .partial()
  .required({ version: true });

export const USER_UPDATE_FIELDS = Object.freeze(Object.keys(userUpdateSchema.shape));

export const transferOwnershipSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(1024),
});
