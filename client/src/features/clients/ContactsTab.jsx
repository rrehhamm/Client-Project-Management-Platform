// FR-CON-01/02, D-16: client contacts, primary contact, commercial authority.
import { zodResolver } from '@hookform/resolvers/zod';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useContacts, useCreateContact, useDeleteContact, useUpdateContact } from '@/api/clients';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

const schema = z.object({
  full_name: z.string().trim().min(1, 'Enter a name').max(120),
  email: z.string().trim().pipe(z.email({ message: 'Enter a valid email address' })),
  phone: z.string().max(40),
  job_title: z.string().max(120),
  is_primary: z.boolean(),
  commercial_authority: z.boolean(),
});

function ContactFormDialog({ clientId, contact, onOpenChange }) {
  const editing = Boolean(contact);
  const create = useCreateContact();
  const update = useUpdateContact();
  const mutation = editing ? update : create;
  const { register, handleSubmit, formState, setError } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: contact?.full_name ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      job_title: contact?.job_title ?? '',
      is_primary: contact?.is_primary ?? false,
      commercial_authority: contact?.commercial_authority ?? false,
    },
  });
  const onSubmit = handleSubmit((v) => {
    const d = formState.dirtyFields;
    const body = {};
    for (const k of Object.keys(v)) if (!editing || d[k]) body[k] = typeof v[k] === 'string' && k !== 'full_name' && k !== 'email' ? v[k] || null : v[k];
    if (!editing && !d.commercial_authority) delete body.commercial_authority; // server default: primary gets it (D-16)
    if (editing && Object.keys(body).length === 0) return onOpenChange(false);
    mutation.mutate(editing ? { id: contact.id, version: contact.version, ...body } : { clientId, ...body }, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => applyFieldErrors(err, setError),
    });
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('contacts.form.editTitle', { name: contact.full_name }) : t('contacts.form.addTitle')}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {mutation.error && !mutation.error.fields.length ? <Alert variant="destructive">{mutation.error.message}</Alert> : null}
          <FormField label={t('contacts.form.fullName')} error={formState.errors.full_name?.message}>
            <Input autoFocus {...register('full_name')} />
          </FormField>
          <FormField label={t('contacts.form.email')} error={formState.errors.email?.message}>
            <Input type="email" {...register('email')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('contacts.form.phone')} error={formState.errors.phone?.message}>
              <Input type="tel" {...register('phone')} />
            </FormField>
            <FormField label={t('contacts.form.jobTitle')} error={formState.errors.job_title?.message}>
              <Input {...register('job_title')} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" disabled={contact?.is_primary} {...register('is_primary')} />
            {t('contacts.form.primary')}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" {...register('commercial_authority')} />
            <span>
              {t('contacts.commercialAuthority')}
              <span className="block text-xs text-muted-foreground">{t('contacts.commercialAuthorityHint')}</span>
            </span>
          </label>
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

export function ContactsTab({ client, canManage }) {
  const contacts = useContacts(client.id);
  const remove = useDeleteContact();
  const update = useUpdateContact();
  const [dialog, setDialog] = useState(null); // { type: 'form' | 'delete', contact }

  if (contacts.isPending) return <LoadingState rows={3} />;
  if (contacts.error) return <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />;
  const list = contacts.data.data;

  return (
    <div className="space-y-4">
      {canManage && client.status !== 'Archived' ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ type: 'form', contact: null })}>{t('contacts.add')}</Button>
        </div>
      ) : null}
      {update.error ? <Alert variant="destructive">{update.error.message}</Alert> : null}
      {list.length === 0 ? (
        <EmptyState title={t('contacts.empty')} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map((c) => (
            <li key={c.id} data-testid={`contact-row-${c.email}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {c.full_name}
                  {c.is_primary ? (
                    <Badge variant="secondary">
                      <Star aria-hidden="true" className="mr-1 size-3" />
                      {t('contacts.primary')}
                    </Badge>
                  ) : null}
                  {c.commercial_authority ? <Badge variant="outline">{t('contacts.commercialAuthority')}</Badge> : null}
                </div>
                <div className="text-muted-foreground">
                  {c.email}
                  {c.job_title ? ` · ${c.job_title}` : ''}
                </div>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-1">
                  {!c.is_primary ? (
                    <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: c.id, version: c.version, is_primary: true })}>
                      {t('contacts.makePrimary')}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" aria-label={`${t('common.edit')}: ${c.full_name}`} onClick={() => setDialog({ type: 'form', contact: c })}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`${t('common.delete')}: ${c.full_name}`} onClick={() => setDialog({ type: 'delete', contact: c })}>
                    {t('common.delete')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {dialog?.type === 'form' ? <ContactFormDialog clientId={client.id} contact={dialog.contact} onOpenChange={(o) => !o && setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        onOpenChange={(o) => {
          if (!o) {
            remove.reset();
            setDialog(null);
          }
        }}
        title={t('contacts.confirmDelete', { name: dialog?.contact?.full_name })}
        description={t('contacts.confirmDeleteBody')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(dialog.contact.id, { onSuccess: () => setDialog(null) })}
      />
    </div>
  );
}
