// FR-MS-01…03: milestones with completion, reordering, visibility and amounts (BR-PRJ-06).
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useCompleteMilestone, useCreateMilestone, useDeleteMilestone, useMilestones, useReorderMilestones, useUpdateMilestone } from '@/api/projects';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { MilestoneStatusBadge } from '@/components/StatusBadges';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { formatDate, formatMoney } from '@/lib/format';
import { minorToText, moneyText, textToMinor } from '@/lib/money';

function MilestoneDialog({ project, milestone, onOpenChange, onWarnings }) {
  const editing = Boolean(milestone);
  const create = useCreateMilestone();
  const update = useUpdateMilestone();
  const mutation = editing ? update : create;
  const currency = project.currency ?? 'JOD';
  const fixed = project.billing_type === 'Fixed';
  const [overBudget, setOverBudget] = useState(false);

  const schema = z.object({
    title: z.string().trim().min(1, 'Enter a title').max(255),
    description: z.string().max(10_000),
    due_date: z.string().min(1, 'Choose a due date'),
    amount: moneyText(currency),
    visibility: z.enum(['Internal', 'Client']),
    status: z.string(),
  });
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: milestone?.title ?? '',
      description: milestone?.description ?? '',
      due_date: milestone?.due_date ?? '',
      amount: minorToText(milestone?.amount, currency),
      visibility: milestone?.visibility ?? 'Internal',
      status: milestone?.status ?? 'Upcoming',
    },
  });

  const submit = (confirm) =>
    handleSubmit((v) => {
      const body = { title: v.title, description: v.description || null, due_date: v.due_date, visibility: v.visibility };
      if (fixed && 'budget_amount' in project) body.amount = textToMinor(v.amount, currency);
      if (editing && v.status !== milestone.status && v.status !== 'Completed') body.status = v.status;
      if (confirm) body.confirm_over_budget = true;
      mutation.mutate(editing ? { id: milestone.id, version: milestone.version, ...body } : { projectId: project.id, ...body }, {
        onSuccess: (res) => {
          onWarnings(res.warnings ?? []);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err.code === 'CONFIRMATION_REQUIRED') setOverBudget(true);
          else applyFieldErrors(err, setError);
        },
      });
    })();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('milestones.form.editTitle') : t('milestones.form.addTitle')}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
          className="grid gap-4"
        >
          {overBudget ? (
            <Alert variant="warning">
              {t('milestones.overBudget')}{' '}
              <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => submit(true)}>
                {t('milestones.saveAnyway')}
              </Button>
            </Alert>
          ) : null}
          {mutation.error && !mutation.error.fields.length && mutation.error.code !== 'CONFIRMATION_REQUIRED' ? (
            <Alert variant="destructive">{mutation.error.message}</Alert>
          ) : null}
          <FormField label={t('milestones.form.title')} error={formState.errors.title?.message}>
            <Input autoFocus {...register('title')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('milestones.form.dueDate')} error={formState.errors.due_date?.message}>
              <Input type="date" {...register('due_date')} />
            </FormField>
            <FormField label={t('milestones.form.visibility')}>
              <Select {...register('visibility')}>
                <option value="Internal">{t('visibility.Internal')}</option>
                <option value="Client">{t('visibility.Client')}</option>
              </Select>
            </FormField>
          </div>
          {fixed && 'budget_amount' in project ? (
            <FormField label={t('milestones.form.amount', { currency })} error={formState.errors.amount?.message} hint={t('milestones.form.amountHint')}>
              <Input inputMode="decimal" {...register('amount')} />
            </FormField>
          ) : null}
          {editing && milestone.status !== 'Completed' ? (
            <FormField label={t('milestones.form.status')}>
              <Select {...register('status')}>
                <option value="Upcoming">{t('milestoneStatus.Upcoming')}</option>
                <option value="InProgress">{t('milestoneStatus.InProgress')}</option>
              </Select>
            </FormField>
          ) : null}
          <FormField label={t('milestones.form.description')}>
            <Textarea rows={3} {...register('description')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MilestonesTab({ project, dateFormat }) {
  const query = useMilestones(project.id);
  const complete = useCompleteMilestone();
  const update = useUpdateMilestone();
  const reorder = useReorderMilestones();
  const remove = useDeleteMilestone();
  const [dialog, setDialog] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const canEdit = project.permissions.manage_milestones && !project.archived_at;

  if (query.isPending) return <LoadingState rows={3} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const list = query.data.data;
  const error = complete.error ?? update.error ?? reorder.error;

  const move = (i, dir) => {
    const ids = list.map((m) => m.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate({ projectId: project.id, ids });
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ type: 'form', milestone: null })}>{t('milestones.add')}</Button>
        </div>
      ) : null}
      <div aria-live="polite">
        {warnings.map((w) => (
          <Alert key={w} variant="warning">
            {w}
          </Alert>
        ))}
        {error ? (
          <Alert variant="destructive">
            {error.message}
            {error.fields?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {error.fields.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('milestones.empty')} />
      ) : (
        <ol className="divide-y rounded-lg border">
          {list.map((m, i) => (
            <li key={m.id} data-testid={`milestone-${m.title}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {m.title}
                  <MilestoneStatusBadge status={m.status} />
                  {m.is_overdue ? <Badge variant="destructive">{t('milestones.overdue')}</Badge> : null}
                  {m.visibility === 'Client' ? <Badge variant="outline">{t('visibility.Client')}</Badge> : null}
                </div>
                <div className="text-muted-foreground">
                  {formatDate(m.due_date, dateFormat)}
                  {' · '}
                  {t('milestones.tasks', { open: m.open_task_count, total: m.task_count })}
                  {m.amount !== undefined && m.amount !== null ? ` · ${formatMoney(m.amount, project.currency)}` : ''}
                </div>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${t('common.moveUp')}: ${m.title}`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t('common.moveDown')}: ${m.title}`} disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  {m.status === 'Completed' ? (
                    <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: m.id, version: m.version, status: 'InProgress' })}>
                      {t('milestones.reopen')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => complete.mutate(m.id)}>
                      {t('milestones.complete')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" aria-label={`${t('common.edit')}: ${m.title}`} onClick={() => setDialog({ type: 'form', milestone: m })}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`${t('common.delete')}: ${m.title}`} onClick={() => setDialog({ type: 'delete', milestone: m })}>
                    {t('common.delete')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {dialog?.type === 'form' ? (
        <MilestoneDialog project={project} milestone={dialog.milestone} onOpenChange={(o) => !o && setDialog(null)} onWarnings={setWarnings} />
      ) : null}
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('milestones.confirmDelete', { title: dialog?.milestone?.title })}
        description={t('milestones.confirmDeleteBody')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(dialog.milestone.id, { onSuccess: () => setDialog(null) })}
      />
    </div>
  );
}
