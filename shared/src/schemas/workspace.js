// FR-WS-01 workspace settings.
import { z } from 'zod';
import { currencySchema, timeZoneSchema, trimmedString } from './common.js';

export const DATE_FORMATS = Object.freeze(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
export const BRAND_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // FR-WS-01: PNG/SVG ≤ 2 MB
export const LOGO_TYPES = Object.freeze(['image/png', 'image/svg+xml']);

export const workspaceUpdateSchema = z
  .object({
    name: trimmedString(1, 120),
    brand_color: z.string().regex(BRAND_COLOR_RE, 'Use a colour like #2563EB').nullable(),
    timezone: timeZoneSchema,
    currency: currencySchema,
    date_format: z.enum(DATE_FORMATS),
    week_start_day: z.number().int().min(0).max(6),
    version: z.number().int().positive(),
  })
  .partial()
  .required({ version: true });
