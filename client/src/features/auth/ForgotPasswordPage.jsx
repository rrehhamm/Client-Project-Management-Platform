// FR-AUTH-08: always the same answer, whether or not the email exists.
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { useForgotPassword } from '@/api/auth';
import { AuthCard } from '@/components/AuthLayout';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  return (
    <AuthCard title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      {forgot.isSuccess ? (
        <Alert variant="success">{t('auth.forgot.sent')}</Alert>
      ) : (
        <form noValidate onSubmit={handleSubmit((v) => forgot.mutate(v))} className="grid gap-4">
          {forgot.error ? <Alert variant="destructive">{forgot.error.message}</Alert> : null}
          <FormField label={t('auth.email')} error={formState.errors.email?.message}>
            <Input type="email" autoComplete="username" autoFocus {...register('email')} />
          </FormField>
          <Button type="submit" disabled={forgot.isPending}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-center text-sm text-primary underline-offset-4 hover:underline">
        {t('auth.forgot.backToLogin')}
      </Link>
    </AuthCard>
  );
}
