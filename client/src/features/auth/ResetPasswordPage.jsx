// FR-AUTH-08: set a new password from an emailed link (single use, 60 minutes).
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { useResetPassword } from '@/api/auth';
import { applyFieldErrors } from '@/api/client';
import { AuthCard } from '@/components/AuthLayout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { newPasswordFormSchema } from './passwordForm';
import { PasswordFields } from './PasswordFields';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const reset = useResetPassword();
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(newPasswordFormSchema()),
    defaultValues: { password: '', confirm: '' },
  });

  if (!token) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <Alert variant="destructive">{t('auth.reset.missingToken')}</Alert>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm text-brand-text hover:underline">
          {t('auth.reset.requestNew')}
        </Link>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(({ password }) =>
    reset.mutate({ token, password }, { onError: (err) => applyFieldErrors(err, setError) }),
  );

  return (
    <AuthCard title={t('auth.reset.title')}>
      {reset.isSuccess ? (
        <div className="grid gap-4">
          <Alert variant="success">{t('auth.reset.done')}</Alert>
          <Button asChild>
            <Link to="/login">{t('auth.login.submit')}</Link>
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {reset.error && !reset.error.fields.length ? (
            <Alert variant="destructive">
              {reset.error.message}{' '}
              {reset.error.status === 410 ? (
                <Link to="/forgot-password" className="underline">
                  {t('auth.reset.requestNew')}
                </Link>
              ) : null}
            </Alert>
          ) : null}
          <PasswordFields register={register} errors={formState.errors} />
          <Button type="submit" disabled={reset.isPending}>
            {t('auth.reset.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
