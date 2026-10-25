// FR-WS-01: workspace name, logo, brand colour, timezone, currency (D-21), date format, week start.
import { zodResolver } from '@hookform/resolvers/zod';
import { CURRENCY_CODES, DATE_FORMATS, LOGO_MAX_BYTES, LOGO_TYPES } from '@cpm/shared';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useRemoveLogo, useUpdateWorkspace, useUploadLogo, useWorkspace } from '@/api/workspace';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t, tList } from '@/i18n';
import { timeZones } from '@/lib/format';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #2563EB'),
  timezone: z.string().min(1),
  currency: z.string(),
  date_format: z.string(),
  week_start_day: z.coerce.number().int().min(0).max(6),
});

function SettingsForm({ ws }) {
  const update = useUpdateWorkspace();
  const { register, handleSubmit, formState, setError, reset, control } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: ws.name,
      brand_color: ws.brand_color ?? '#2563EB',
      timezone: ws.timezone,
      currency: ws.currency,
      date_format: ws.date_format,
      week_start_day: ws.week_start_day,
    },
  });
  const brandColor = useWatch({ control, name: 'brand_color' });
  const onSubmit = handleSubmit((v) => {
    const body = {};
    for (const k of Object.keys(v)) if (formState.dirtyFields[k]) body[k] = v[k];
    if (!Object.keys(body).length) return;
    update.mutate({ version: ws.version, ...body }, { onSuccess: () => reset(v), onError: (err) => applyFieldErrors(err, setError) });
  });
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {update.isSuccess && !formState.isDirty ? (
        <Alert variant="success" className="sm:col-span-2">
          {t('settings.saved')}
        </Alert>
      ) : null}
      {update.error && !update.error.fields.length ? (
        <Alert variant="destructive" className="sm:col-span-2">
          {update.error.message}
        </Alert>
      ) : null}
      <FormField label={t('settings.name')} error={formState.errors.name?.message}>
        <Input {...register('name')} />
      </FormField>
      <FormField label={t('settings.brandColor')} error={formState.errors.brand_color?.message}>
        <div className="flex gap-2">
          <Input {...register('brand_color')} />
          <span aria-hidden="true" className="size-9 shrink-0 rounded-md border" style={{ background: brandColor }} />
        </div>
      </FormField>
      <FormField label={t('settings.timezone')}>
        <Select {...register('timezone')}>
          {timeZones().map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('settings.currency')} error={formState.errors.currency?.message} hint={ws.currency_locked ? t('settings.currencyLocked') : undefined}>
        <Select {...register('currency')} disabled={ws.currency_locked}>
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('settings.dateFormat')}>
        <Select {...register('date_format')}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t('settings.weekStart')}>
        <Select {...register('week_start_day')}>
          {tList('settings.days').map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={update.isPending || !formState.isDirty}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function LogoCard({ ws }) {
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const input = useRef(null);
  const [localError, setLocalError] = useState(null);
  const error = localError ?? upload.error?.message ?? remove.error?.message;

  const onFile = (file) => {
    setLocalError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLocalError(t('settings.logoHint'));
    if (file.size > LOGO_MAX_BYTES) return setLocalError(t('settings.logoHint'));
    upload.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.logo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {upload.isSuccess ? <Alert variant="success">{t('settings.logoSaved')}</Alert> : null}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-20 items-center justify-center rounded-lg border bg-muted/40">
            {ws.logo_url ? <img src={ws.logo_url} alt={ws.name} className="max-h-16 max-w-16 object-contain" /> : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('settings.logoHint')}</p>
            <div className="flex gap-2">
              <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" aria-label={t('settings.uploadLogo')} onChange={(e) => onFile(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
                {t('settings.uploadLogo')}
              </Button>
              {ws.logo_url ? (
                <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  {t('settings.removeLogo')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkspaceSettingsPage() {
  const ws = useWorkspace();
  if (ws.isPending) return <LoadingState rows={6} />;
  if (ws.error) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <LogoCard ws={ws.data} />
      <Card>
        <CardContent>
          <SettingsForm key={ws.data.version} ws={ws.data} />
        </CardContent>
      </Card>
    </div>
  );
}
