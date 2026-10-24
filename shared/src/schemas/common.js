// Building blocks for request schemas shared by client forms and server routes.
import { z } from 'zod';
import { CURRENCY_CODES, PAGINATION, VISIBILITY } from '../constants.js';
import { isIsoDate, isValidTimeZone } from '../dates.js';

export const uuidSchema = z.uuid();

/** BR-AUTH-04: emails are trimmed and compared case-insensitively. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

/** Calendar date "YYYY-MM-DD" (no time part). */
export const isoDateSchema = z.string().refine(isIsoDate, { message: 'Enter a valid date (YYYY-MM-DD)' });

export const timeZoneSchema = z.string().refine(isValidTimeZone, { message: 'Unknown time zone' });

export const currencySchema = z.enum(CURRENCY_CODES);

export const visibilitySchema = z.enum([VISIBILITY.INTERNAL, VISIBILITY.CLIENT]);

/** Trimmed text with length limits, e.g. trimmedString(2, 120) for client names. */
export const trimmedString = (min, max) => z.string().trim().min(min).max(max);

/** NFR-PERF-03: default 25, max 100. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
});
