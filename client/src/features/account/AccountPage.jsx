// FR-AUTH-13 profile, email change with verification, and FR-AUTH-09 password change.
// Avatar and notification preferences come in Phase 4.
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, emailChangeSchema, passwordSchema } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useChangePassword, useMe, useRequestEmailChange, useUpdateAppearance, useUpdateProfile } from '@/api/auth';
import { applyFieldErrors } from '@/api/client';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { timeZones } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AvatarForm, NotificationPrefsForm } from './AccountExtras';

const profileFormSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40),
  timezone: z.string(),
});

function ProfileForm({ me }) {
  const update = useUpdateProfile();
  const p = me.principal;
  const { register, handleSubmit, formState, setError, reset } = useForm({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { full_name: p.full_name, phone: p.phone ?? '', timezone: p.timezone ?? '' },
  });
  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { full_name: v.full_name, phone: v.phone || null, timezone: v.timezone || null, version: p.version },
      {
        onSuccess: (data) =>
          reset({ full_name: data.principal.full_name, phone: data.principal.phone ?? '', timezone: data.principal.timezone ?? '' }),
        onError: (err) => applyFieldErrors(err, setError),
      },
    ),
  );
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {update.isSuccess && !formState.isDirty ? <Alert variant="success">{t('account.profile.saved')}</Alert> : null}
      {update.error && !update.error.fields.length ? <Alert variant="destructive">{update.error.message}</Alert> : null}
      <FormField label={t('account.profile.fullName')} error={formState.errors.full_name?.message}>
        <Input autoComplete="name" {...register('full_name')} />
      </FormField>
      <FormField label={t('account.profile.phone')} error={formState.errors.phone?.message}>
        <Input type="tel" autoComplete="tel" {...register('phone')} />
      </FormField>
      <FormField label={t('account.profile.timezone')} error={formState.errors.timezone?.message}>
        <Select {...register('timezone')}>
          <option value="">{t('account.profile.timezoneDefault', { tz: me.workspace.timezone })}</option>
          {timeZones().map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </FormField>
      <div>
        <Button type="submit" disabled={update.isPending || !formState.isDirty}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function EmailForm({ me }) {
  const request = useRequestEmailChange();
  const { register, handleSubmit, formState, setError, getValues } = useForm({
    resolver: zodResolver(emailChangeSchema),
    defaultValues: { new_email: '', current_password: '' },
  });
  const onSubmit = handleSubmit((v) => request.mutate(v, { onError: (err) => applyFieldErrors(err, setError) }));
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('account.email.current', { email: me.principal.email })}</p>
      {request.isSuccess ? <Alert variant="success">{t('account.email.sent', { email: getValues('new_email') })}</Alert> : null}
      {request.error && !request.error.fields.length ? <Alert variant="destructive">{request.error.message}</Alert> : null}
      <FormField label={t('account.email.newEmail')} error={formState.errors.new_email?.message}>
        <Input type="email" autoComplete="email" {...register('new_email')} />
      </FormField>
      <FormField label={t('account.email.currentPassword')} error={formState.errors.current_password?.message}>
        <Input type="password" autoComplete="current-password" {...register('current_password')} />
      </FormField>
      <div>
        <Button type="submit" variant="outline" disabled={request.isPending}>
          {t('account.email.submit')}
        </Button>
      </div>
    </form>
  );
}

const passwordFormSchema = changePasswordSchema
  .extend({ new_password: passwordSchema, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: t('auth.passwordsDontMatch') });

function PasswordForm() {
  const change = useChangePassword();
  const { register, handleSubmit, formState, setError, reset } = useForm({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { current_password: '', new_password: '', confirm: '' },
  });
  const onSubmit = handleSubmit(({ current_password, new_password }) =>
    change.mutate(
      { current_password, new_password },
      { onSuccess: () => reset(), onError: (err) => applyFieldErrors(err, setError) },
    ),
  );
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {change.isSuccess ? <Alert variant="success">{t('account.password.done')}</Alert> : null}
      {change.error && !change.error.fields.length ? <Alert variant="destructive">{change.error.message}</Alert> : null}
      <FormField label={t('account.password.currentPassword')} error={formState.errors.current_password?.message}>
        <Input type="password" autoComplete="current-password" {...register('current_password')} />
      </FormField>
      <FormField label={t('auth.newPassword')} error={formState.errors.new_password?.message} hint={t('auth.passwordHint')}>
        <Input type="password" autoComplete="new-password" {...register('new_password')} />
      </FormField>
      <FormField label={t('auth.confirmPassword')} error={formState.errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...register('confirm')} />
      </FormField>
      <div>
        <Button type="submit" variant="outline" disabled={change.isPending}>
          {t('account.password.submit')}
        </Button>
      </div>
    </form>
  );
}

const APPEARANCE_OPTIONS = [
  ['system', Monitor],
  ['light', Sun],
  ['dark', Moon],
];

/** D-45: System (default), Light or Dark, saved per user. Arrow keys move between options. */
function AppearanceForm({ me }) {
  const update = useUpdateAppearance();
  const current = me.principal.appearance ?? 'system';
  const onKeyDown = (e, i) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = APPEARANCE_OPTIONS[(i + step + APPEARANCE_OPTIONS.length) % APPEARANCE_OPTIONS.length][0];
    update.mutate(next);
    e.currentTarget.parentElement.querySelector(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('account.appearance.hint')}</p>
      <div role="radiogroup" aria-label={t('account.appearance.label')} className="grid gap-2 sm:grid-cols-3">
        {APPEARANCE_OPTIONS.map(([value, Icon], i) => {
          const checked = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              data-value={value}
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => update.mutate(value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-start text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                checked ? 'border-brand-text bg-brand-soft' : 'hover:bg-accent',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4 shrink-0', checked ? 'text-brand-text' : 'text-muted-foreground')} />
              <span>
                <span className="block font-medium">{t(`account.appearance.${value}`)}</span>
                {value === 'system' ? <span className="block text-xs text-muted-foreground">{t('account.appearance.systemHint')}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {update.error ? <Alert variant="destructive">{update.error.message}</Alert> : null}
    </div>
  );
}

export function AccountPage() {
  const { data: me } = useMe();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('account.title')}</h1>
      {me.principal.kind === 'user' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('account.avatar.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AvatarForm me={me} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm me={me} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('account.appearance.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AppearanceForm me={me} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('account.email.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailForm me={me} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('account.password.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      {me.principal.kind === 'user' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.prefsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NotificationPrefsForm />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
