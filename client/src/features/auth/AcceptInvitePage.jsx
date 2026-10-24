// FR-AUTH-07: set a password from an invitation (name prefilled, 7 days, single use).
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { useAcceptInvitation, useInvitation } from '@/api/auth';
import { applyFieldErrors } from '@/api/client';
import { AuthCard } from '@/components/AuthLayout';
import { LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { t } from '@/i18n';
import { newPasswordFormSchema } from './passwordForm';
import { PasswordFields } from './PasswordFields';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const invitation = useInvitation(token);
  const accept = useAcceptInvitation();
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(newPasswordFormSchema()),
    defaultValues: { password: '', confirm: '' },
  });

  if (!token || invitation.error) {
    return (
      <AuthCard title={t('auth.login.title')}>
        <Alert variant="destructive">{invitation.error?.message ?? t('auth.reset.missingToken')}</Alert>
      </AuthCard>
    );
  }
  if (invitation.isPending) return <AuthCard title={t('states.loading')}><LoadingState rows={2} /></AuthCard>;

  const { email, full_name: fullName, workspace_name: workspace } = invitation.data;
  const onSubmit = handleSubmit(({ password }) =>
    accept.mutate(
      { token, password },
      {
        onSuccess: (data) => navigate(data.home, { replace: true }),
        onError: (err) => applyFieldErrors(err, setError),
      },
    ),
  );

  return (
    <AuthCard title={t('auth.invite.title', { workspace })} subtitle={t('auth.invite.subtitle', { name: fullName })}>
      <form noValidate onSubmit={onSubmit} className="grid gap-4">
        {accept.error && !accept.error.fields.length ? <Alert variant="destructive">{accept.error.message}</Alert> : null}
        <FormField label={t('auth.email')}>
          <Input type="email" value={email} readOnly autoComplete="username" />
        </FormField>
        <PasswordFields register={register} errors={formState.errors} label={t('auth.password')} />
        <Button type="submit" disabled={accept.isPending}>
          {t('auth.invite.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
