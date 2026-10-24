// FR-USER-04 role, FR-USER-07 rates, FR-USER-09 capacity. Fields the viewer may
// not change are not shown; the API rejects them anyway (rule 3).
import { zodResolver } from '@hookform/resolvers/zod';
import { ASSIGNABLE_ROLES, fromMinor, toMinor } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useUpdateUser } from '@/api/users';
import { applyFieldErrors } from '@/api/client';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';

const moneyText = (currency) =>
  z.string().trim().refine(
    (v) => {
      if (v === '') return true;
      try {
        return toMinor(v, currency) >= 0n;
      } catch {
        return false;
      }
    },
    { message: 'Enter an amount like 25.500' },
  );

export function EditUserDialog({ user, me, onOpenChange, onSaved }) {
  const update = useUpdateUser();
  const currency = me.workspace.currency;
  const caps = me.capabilities;
  const isSelf = user.id === me.principal.id;
  const isOwnerTarget = user.role === 'Owner';
  const canEditBasics = caps.change_roles && (!isOwnerTarget || me.principal.role === 'Owner');
  const canEditRole = canEditBasics && !isSelf && !isOwnerTarget;
  const canEditRates = caps.edit_rates && (!isOwnerTarget || me.principal.role !== 'Admin');

  const schema = z.object({
    full_name: z.string().trim().min(1).max(120),
    role: z.string(),
    capacity_hours: z.coerce.number().min(0).max(168),
    hourly_cost_rate: moneyText(currency),
    default_bill_rate: moneyText(currency),
  });
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: user.full_name,
      role: user.role,
      capacity_hours: user.capacity_minutes_per_week / 60,
      hourly_cost_rate: user.hourly_cost_rate === null || user.hourly_cost_rate === undefined ? '' : fromMinor(user.hourly_cost_rate, currency),
      default_bill_rate: user.default_bill_rate === null || user.default_bill_rate === undefined ? '' : fromMinor(user.default_bill_rate, currency),
    },
  });

  const onSubmit = handleSubmit((v) => {
    const body = { id: user.id, version: user.version };
    const d = formState.dirtyFields;
    if (canEditBasics && d.full_name) body.full_name = v.full_name;
    if (canEditBasics && d.capacity_hours) body.capacity_minutes_per_week = Math.round(v.capacity_hours * 60);
    if (canEditRole && d.role) body.role = v.role;
    const rate = (s) => (s === '' ? null : Number(toMinor(s, currency)));
    if (canEditRates && d.hourly_cost_rate) body.hourly_cost_rate = rate(v.hourly_cost_rate);
    if (canEditRates && d.default_bill_rate) body.default_bill_rate = rate(v.default_bill_rate);
    if (Object.keys(body).length === 2) return onOpenChange(false);
    update.mutate(body, {
      onSuccess: () => {
        onSaved(t('team.toast.saved'));
        onOpenChange(false);
      },
      onError: (err) => applyFieldErrors(err, setError, { capacity_minutes_per_week: 'capacity_hours' }),
    });
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team.editDialog.title', { name: user.full_name })}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {update.error && !update.error.fields.length ? <Alert variant="destructive">{update.error.message}</Alert> : null}
          {canEditBasics ? (
            <>
              <FormField label={t('team.editDialog.fullName')} error={formState.errors.full_name?.message}>
                <Input {...register('full_name')} />
              </FormField>
              <FormField
                label={t('team.editDialog.role')}
                hint={isOwnerTarget ? t('team.editDialog.ownerRoleLocked') : isSelf ? t('team.editDialog.ownRoleLocked') : undefined}
              >
                <Select {...register('role')} disabled={!canEditRole}>
                  {(isOwnerTarget ? ['Owner'] : ASSIGNABLE_ROLES).map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('team.editDialog.capacity')} error={formState.errors.capacity_hours?.message}>
                <Input type="number" min="0" max="168" step="0.5" {...register('capacity_hours')} />
              </FormField>
            </>
          ) : null}
          {canEditRates ? (
            <>
              <FormField label={t('team.editDialog.costRate', { currency })} error={formState.errors.hourly_cost_rate?.message} hint={t('team.editDialog.ratesHint')}>
                <Input inputMode="decimal" {...register('hourly_cost_rate')} />
              </FormField>
              <FormField label={t('team.editDialog.billRate', { currency })} error={formState.errors.default_bill_rate?.message}>
                <Input inputMode="decimal" {...register('default_bill_rate')} />
              </FormField>
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
