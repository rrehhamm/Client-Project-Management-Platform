// FR-PRJ-04: edit a project (name, dates, PM, billing, budget, portal settings).
import { zodResolver } from '@hookform/resolvers/zod';
import { BILLING_TYPE } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useUpdateProject } from '@/api/projects';
import { useUsers } from '@/api/users';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { minorToText, moneyText, textToMinor } from '@/lib/money';

const PM_ROLES = ['PM', 'Admin', 'Owner'];

export function ProjectSettingsForm({ project, onSaved }) {
  const update = useUpdateProject();
  const users = useUsers({ assignable: true, page_size: 100 });
  const pms = (users.data?.data ?? []).filter((u) => PM_ROLES.includes(u.role));
  const currency = project.currency ?? 'JOD';
  const showMoney = 'budget_amount' in project;

  const schema = z
    .object({
      name: z.string().trim().min(2).max(150),
      description: z.string().max(10_000),
      start_date: z.string().min(1),
      due_date: z.string(),
      billing_type: z.string(),
      pm_user_id: z.string().min(1),
      budget_amount: showMoney ? moneyText(currency) : z.string(),
      budget_hours: z.string().regex(/^(\d+(\.\d+)?)?$/, 'Enter a number of hours'),
      portal_enabled: z.boolean(),
      close_task_on_approval: z.boolean(),
    })
    .refine((v) => !v.due_date || v.due_date >= v.start_date, { path: ['due_date'], message: 'Due date cannot be before start date' });

  const { register, handleSubmit, formState, setError, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      start_date: project.start_date,
      due_date: project.due_date ?? '',
      billing_type: project.billing_type,
      pm_user_id: project.pm.id,
      budget_amount: showMoney ? minorToText(project.budget_amount, currency) : '',
      budget_hours: project.budget_minutes ? String(project.budget_minutes / 60) : '',
      portal_enabled: project.portal_enabled,
      close_task_on_approval: project.close_task_on_approval,
    },
  });

  const onSubmit = handleSubmit((v) => {
    const d = formState.dirtyFields;
    const body = {};
    for (const k of ['name', 'start_date', 'billing_type', 'pm_user_id', 'portal_enabled', 'close_task_on_approval']) if (d[k]) body[k] = v[k];
    if (d.description) body.description = v.description || null;
    if (d.due_date) body.due_date = v.due_date || null;
    if (showMoney && d.budget_amount) body.budget_amount = textToMinor(v.budget_amount, currency);
    if (d.budget_hours) body.budget_minutes = v.budget_hours ? Math.round(Number(v.budget_hours) * 60) : null;
    if (Object.keys(body).length === 0) return;
    update.mutate(
      { id: project.id, version: project.version, ...body },
      {
        onSuccess: (saved) => {
          reset(v);
          onSaved(saved);
        },
        onError: (err) => applyFieldErrors(err, setError, { budget_minutes: 'budget_hours' }),
      },
    );
  });

  return (
    <form noValidate onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {update.error && !update.error.fields.length ? (
        <Alert variant="destructive" className="sm:col-span-2">
          {update.error.message}
        </Alert>
      ) : null}
      <div className="sm:col-span-2">
        <FormField label={t('projects.form.name')} error={formState.errors.name?.message}>
          <Input {...register('name')} />
        </FormField>
      </div>
      <FormField label={t('projects.form.startDate')} error={formState.errors.start_date?.message}>
        <Input type="date" {...register('start_date')} />
      </FormField>
      <FormField label={t('projects.form.dueDate')} error={formState.errors.due_date?.message}>
        <Input type="date" {...register('due_date')} />
      </FormField>
      <FormField label={t('projects.form.pm')} error={formState.errors.pm_user_id?.message}>
        <Select {...register('pm_user_id')}>
          {!pms.some((u) => u.id === project.pm.id) ? <option value={project.pm.id}>{project.pm.full_name}</option> : null}
          {pms.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({t(`roles.${u.role}`)})
            </option>
          ))}
        </Select>
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
      {showMoney ? (
        <FormField label={t('projects.form.budgetAmount', { currency })} error={formState.errors.budget_amount?.message}>
          <Input inputMode="decimal" {...register('budget_amount')} />
        </FormField>
      ) : null}
      {showMoney ? (
        <FormField label={t('projects.form.budgetHours')} error={formState.errors.budget_hours?.message}>
          <Input inputMode="decimal" {...register('budget_hours')} />
        </FormField>
      ) : null}
      <div className="sm:col-span-2">
        <FormField label={t('projects.form.description')}>
          <Textarea rows={3} {...register('description')} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-4 accent-primary" {...register('portal_enabled')} />
        {t('projects.form.portalEnabled')}
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-4 accent-primary" {...register('close_task_on_approval')} />
        {t('projects.form.closeTaskOnApproval')}
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={update.isPending || !formState.isDirty}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
