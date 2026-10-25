// FR-PRJ-01: create a project. PM picker lists active PMs, Admins and Owners (D-19).
import { zodResolver } from '@hookform/resolvers/zod';
import { BILLING_TYPE } from '@cpm/shared';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useClients } from '@/api/clients';
import { useCreateProject } from '@/api/projects';
import { useUsers } from '@/api/users';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { moneyText, textToMinor } from '@/lib/money';

const PM_ROLES = ['PM', 'Admin', 'Owner'];

export function ProjectFormDialog({ me, clientId, onOpenChange, onSaved }) {
  const create = useCreateProject();
  const clients = useClients({ status: 'Active', page_size: 100, sort: 'name', order: 'asc' });
  const users = useUsers({ assignable: true, page_size: 100 });
  const pms = (users.data?.data ?? []).filter((u) => PM_ROLES.includes(u.role));

  const schema = z
    .object({
      client_id: z.string().min(1, t('projects.form.chooseClient')),
      name: z.string().trim().min(2, 'Use at least 2 characters').max(150),
      description: z.string().max(10_000),
      start_date: z.string().min(1, 'Choose a start date'),
      due_date: z.string(),
      billing_type: z.string(),
      pm_user_id: z.string().min(1, t('projects.form.choosePm')),
      budget_amount: z.string(),
      budget_hours: z.string().regex(/^(\d+(\.\d+)?)?$/, 'Enter a number of hours'),
      portal_enabled: z.boolean(),
    })
    .refine((v) => !v.due_date || v.due_date >= v.start_date, { path: ['due_date'], message: 'Due date cannot be before start date' });

  const { register, handleSubmit, formState, setError, control } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      client_id: clientId ?? '',
      name: '',
      description: '',
      start_date: new Date().toISOString().slice(0, 10),
      due_date: '',
      billing_type: BILLING_TYPE.FIXED,
      pm_user_id: me.principal.role === 'PM' ? me.principal.id : '',
      budget_amount: '',
      budget_hours: '',
      portal_enabled: false,
    },
  });

  const [watchedClient, billing] = useWatch({ control, name: ['client_id', 'billing_type'] });
  const selectedClient = (clients.data?.data ?? []).find((c) => c.id === watchedClient);
  const currency = selectedClient?.currency ?? me.workspace.currency;

  const onSubmit = handleSubmit((v) => {
    try {
      moneyText(currency).parse(v.budget_amount);
    } catch {
      return setError('budget_amount', { message: 'Enter an amount like 12000' });
    }
    create.mutate(
      {
        client_id: v.client_id,
        name: v.name,
        description: v.description || null,
        start_date: v.start_date,
        due_date: v.due_date || null,
        billing_type: v.billing_type,
        pm_user_id: v.pm_user_id,
        budget_amount: textToMinor(v.budget_amount, currency),
        budget_minutes: v.budget_hours ? Math.round(Number(v.budget_hours) * 60) : null,
        portal_enabled: v.portal_enabled,
      },
      {
        onSuccess: (p) => {
          onSaved(p);
          onOpenChange(false);
        },
        onError: (err) => applyFieldErrors(err, setError, { budget_minutes: 'budget_hours' }),
      },
    );
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('projects.form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          {create.error && !create.error.fields.length ? (
            <Alert variant="destructive" className="sm:col-span-2">
              {create.error.message}
            </Alert>
          ) : null}
          <FormField label={t('projects.form.client')} error={formState.errors.client_id?.message}>
            <Select {...register('client_id')} disabled={Boolean(clientId)}>
              <option value="">{t('projects.form.chooseClient')}</option>
              {(clients.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('projects.form.pm')} error={formState.errors.pm_user_id?.message}>
            <Select {...register('pm_user_id')}>
              <option value="">{t('projects.form.choosePm')}</option>
              {pms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({t(`roles.${u.role}`)})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('projects.form.name')} error={formState.errors.name?.message}>
              <Input autoFocus {...register('name')} />
            </FormField>
          </div>
          <FormField label={t('projects.form.startDate')} error={formState.errors.start_date?.message}>
            <Input type="date" {...register('start_date')} />
          </FormField>
          <FormField label={t('projects.form.dueDate')} error={formState.errors.due_date?.message}>
            <Input type="date" {...register('due_date')} />
          </FormField>
          <FormField label={t('projects.form.billingType')}>
            <Select {...register('billing_type')}>
              {Object.values(BILLING_TYPE).map((b) => (
                <option key={b} value={b}>
                  {t(`billingType.${b}`)}
                </option>
              ))}
            </Select>
          </FormField>
          {billing === BILLING_TYPE.HOURLY ? (
            <FormField label={t('projects.form.budgetHours')} error={formState.errors.budget_hours?.message}>
              <Input inputMode="decimal" {...register('budget_hours')} />
            </FormField>
          ) : billing === BILLING_TYPE.NON_BILLABLE ? (
            <div />
          ) : (
            <FormField label={t('projects.form.budgetAmount', { currency })} error={formState.errors.budget_amount?.message}>
              <Input inputMode="decimal" {...register('budget_amount')} />
            </FormField>
          )}
          <div className="sm:col-span-2">
            <FormField label={t('projects.form.description')}>
              <Textarea rows={3} {...register('description')} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-primary" {...register('portal_enabled')} />
            {t('projects.form.portalEnabled')}
          </label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('common.saving') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
