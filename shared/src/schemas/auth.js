// Request schemas for sign-in, passwords and the signed-in user's profile.
// The server also checks the breached-password list (BR-AUTH-01), which is too
// large to ship to the browser.
import { z } from 'zod';
import { emailSchema, timeZoneSchema, trimmedString } from './common.js';

export const PASSWORD_MIN_LENGTH = 10;

/** BR-AUTH-01 rules that can run anywhere. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

/** BR-AUTH-01: the password must not equal the email (case-insensitive). */
export function passwordIsNotEmail(password, email) {
  return !email || password.trim().toLowerCase() !== String(email).trim().toLowerCase();
}

/** Opaque emailed token (base64url). */
export const linkTokenSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid link');

export const loginSchema = z.object({
  email: emailSchema,
  // No policy check at login: old passwords must still work. Length cap stops abuse.
  password: z.string().min(1, 'Enter your password').max(1024),
  remember_me: z.boolean().optional().default(false),
});

export const acceptInviteSchema = z.object({ token: linkTokenSchema, password: passwordSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ token: linkTokenSchema, password: passwordSchema });

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password').max(1024),
  new_password: passwordSchema,
});

/** FR-AUTH-13. Avatar and notification preferences come in Phase 4. */
export const profileUpdateSchema = z.object({
  full_name: trimmedString(1, 120),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: timeZoneSchema.nullable().optional(),
  version: z.number().int().positive(),
});

export const emailChangeSchema = z.object({
  new_email: emailSchema,
  current_password: z.string().min(1, 'Enter your current password').max(1024),
});

export const verifyEmailSchema = z.object({ token: linkTokenSchema });
