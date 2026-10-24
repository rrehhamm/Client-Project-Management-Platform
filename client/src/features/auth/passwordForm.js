import { passwordSchema } from '@cpm/shared';
import { z } from 'zod';
import { t } from '@/i18n';

/** Zod object for forms that set a password (BR-AUTH-01) with a confirmation field. */
export const newPasswordFormSchema = (extra = {}) =>
  z
    .object({ password: passwordSchema, confirm: z.string(), ...extra })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('auth.passwordsDontMatch') });
