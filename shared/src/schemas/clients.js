// FR-CLI-01…08, FR-CON-01/02 request schemas.
import { z } from 'zod';
import { CLIENT_STATUS } from '../constants.js';
import { currencySchema, emailSchema, paginationSchema, trimmedString } from './common.js';

/** Optional free text: trimmed, '' becomes null. */
export const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Statuses a client can be given directly; Archived only via archive/restore (BRD 16.2). */
export const EDITABLE_CLIENT_STATUSES = Object.freeze([CLIENT_STATUS.LEAD, CLIENT_STATUS.ACTIVE, CLIENT_STATUS.INACTIVE]);

export const codePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use exactly 3 letters, e.g. NOV');

const clientFields = {
  name: trimmedString(2, 120),
  status: z.enum(EDITABLE_CLIENT_STATUSES),
  code_prefix: codePrefixSchema,
  industry: optionalText(120),
  website: z
    .union([z.literal(''), z.url().max(2048)])
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  billing_address: optionalText(2000),
  tax_id: optionalText(64),
  currency: currencySchema,
  /** Minor units of the client currency */
  default_bill_rate: z.number().int().min(0).max(1_000_000_000).nullable(),
  payment_terms_days: z.number().int().min(0).max(365),
  internal_notes: optionalText(10_000),
};

export const clientCreateSchema = z.object(clientFields).partial().required({ name: true });

export const clientUpdateSchema = z
  .object({ ...clientFields, version: z.number().int().positive() })
  .partial()
  .required({ version: true });

export const CLIENT_SORTS = Object.freeze(['name', 'created_at', 'status']);

export const clientListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(Object.values(CLIENT_STATUS)).optional(),
  sort: z.enum(CLIENT_SORTS).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const prefixSuggestionQuerySchema = z.object({ name: trimmedString(1, 120) });

const contactFields = {
  full_name: trimmedString(1, 120),
  email: emailSchema,
  phone: optionalText(40),
  job_title: optionalText(120),
  is_primary: z.boolean(),
  commercial_authority: z.boolean(), // D-16
};

export const contactCreateSchema = z.object(contactFields).partial().required({ full_name: true, email: true });

export const contactUpdateSchema = z
  .object({ ...contactFields, version: z.number().int().positive() })
  .partial()
  .required({ version: true });
