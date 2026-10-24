// FR-USER-01: invite a person. PMs may only invite Team Members.
import { zodResolver } from '@hookform/resolvers/zod';
import { ASSIGNABLE_ROLES, inviteUserSchema } from '@cpm/shared';
import { useForm } from 'react-hook-form';
import { useInviteUser } from '@/api/users';
import { applyFieldErrors } from '@/api/client';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';

export function InviteUserDialog({ open, onOpenChange, anyRole, onInvited }) {
  const invite = useInviteUser();
  const roles = anyRole ? ASSIGNABLE_ROLES : ['TeamMember'];
  const { register, handleSubmit, formState, setError, reset } = useForm({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', full_name: '', role: 'TeamMember' },
  });

  const close = (next) => {
    if (!next) {
      reset();
      invite.reset();
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((v) =>
    invite.mutate(v, {
      onSuccess: (data) => {
        onInvited(data.email_sent ? t('team.inviteDialog.sent', { email: data.user.email }) : t('team.inviteDialog.notSent'));
        close(false);
      },
      onError: (err) => applyFieldErrors(err, setError),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team.inviteDialog.title')}</DialogTitle>
          <DialogDescription>{t('team.inviteDialog.description')}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {invite.error && !invite.error.fields.length ? <Alert variant="destructive">{invite.error.message}</Alert> : null}
          <FormField label={t('auth.email')} error={formState.errors.email?.message}>
            <Input type="email" autoComplete="off" {...register('email')} />
          </FormField>
          <FormField label={t('team.inviteDialog.fullName')} error={formState.errors.full_name?.message}>
            <Input autoComplete="off" {...register('full_name')} />
          </FormField>
          <FormField
            label={t('team.inviteDialog.role')}
            error={formState.errors.role?.message}
            hint={anyRole ? undefined : t('team.inviteDialog.onlyTeamMembers')}
          >
            <Select {...register('role')} disabled={!anyRole}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {t('team.inviteDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
