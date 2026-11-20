// FR-AUTH-01/02/03: sign in. Field errors show inline and no request is sent
// until the form is valid.
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useLogin } from '@/api/auth';
import { AuthCard } from '@/components/AuthLayout';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import { safeNext } from '@/lib/navigation';
import { consumeSessionExpiredFlag } from './sessionFlag';

const schema = z.object({
  email: z.string().trim().min(1, t('auth.login.enterEmail')).pipe(z.email({ message: t('auth.login.invalidEmail') })),
  password: z.string().min(1, t('auth.login.enterPassword')),
  remember_me: z.boolean(),
});

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const [expired] = useState(consumeSessionExpiredFlag);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember_me: false },
  });

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (data) => navigate(safeNext(params.get('next')) ?? data.home, { replace: true }),
    }),
  );

  return (
    <AuthCard title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="grid gap-4">
        {expired && !login.error ? <Alert variant="warning">{t('auth.login.expired')}</Alert> : null}
        {login.error ? <Alert variant="destructive">{login.error.message}</Alert> : null}
        <FormField label={t('auth.email')} error={formState.errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...register('email')} />
        </FormField>
        <FormField label={t('auth.password')} error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" {...register('remember_me')} />
          {t('auth.login.rememberMe')}
        </label>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
        <Link to="/forgot-password" className="text-center text-sm text-brand-text underline-offset-4 hover:underline">
          {t('auth.login.forgot')}
        </Link>
      </form>
    </AuthCard>
  );
}
