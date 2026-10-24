// BR-ROLE-01: the Owner hands ownership to an active Admin, confirming with their password.
import { zodResolver } from '@hookform/resolvers/zod';
import { transferOwnershipSchema } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { useTransferOwnership } from '@/api/users';
import { applyFieldErrors } from '@/api/client';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

export function TransferOwnershipDialog({ user, onOpenChange, onDone }) {
  const transfer = useTransferOwnership();
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(transferOwnershipSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = handleSubmit(({ password }) =>
    transfer.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          onDone(t('team.toast.transferred'));
          onOpenChange(false);
        },
        onError: (err) => applyFieldErrors(err, setError),
      },
    ),
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team.transferDialog.title', { name: user.full_name })}</DialogTitle>
          <DialogDescription>{t('team.transferDialog.description')}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {transfer.error && !transfer.error.fields.length ? <Alert variant="destructive">{transfer.error.message}</Alert> : null}
          <FormField label={t('auth.password')} error={formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={transfer.isPending}>
              {t('team.transferDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
