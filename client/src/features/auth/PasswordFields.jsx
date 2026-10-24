// "New password" + "Confirm password" pair. Use with newPasswordFormSchema (passwordForm.js).
import { FormField } from '@/components/FormField';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

export function PasswordFields({ register, errors, label = t('auth.newPassword') }) {
  return (
    <>
      <FormField label={label} error={errors.password?.message} hint={t('auth.passwordHint')}>
        <Input type="password" autoComplete="new-password" {...register('password')} />
      </FormField>
      <FormField label={t('auth.confirmPassword')} error={errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...register('confirm')} />
      </FormField>
    </>
  );
}
