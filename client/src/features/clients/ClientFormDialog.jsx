// FR-CLI-01/02: create or edit a client. The project-code prefix is suggested
// from the name (D-02) and locked after the first project.
import { zodResolver } from '@hookform/resolvers/zod';
import { CURRENCY_CODES, EDITABLE_CLIENT_STATUSES } from '@cpm/shared';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors } from '@/api/client';
import { useCreateClient, usePrefixSuggestion, useUpdateClient } from '@/api/clients';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { minorToText, moneyText, textToMinor } from '@/lib/money';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const schema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(120),
  code_prefix: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/, 'Use exactly 3 letters'),
  status: z.string(),
  currency: z.string(),
  industry: z.string().max(120),
  website: z.union([z.literal(''), z.url({ message: 'Enter a full URL, e.g. https://example.com' })]),
  tax_id: z.string().max(64),
  payment_terms_days: z.coerce.number().int().min(0).max(365),
  billing_address: z.string().max(2000),
  internal_notes: z.string().max(10_000),
  default_bill_rate: z.string(),
});

const FIELDS = ['name', 'code_prefix', 'status', 'currency', 'industry', 'website', 'tax_id', 'payment_terms_days', 'billing_address', 'internal_notes'];

export function ClientFormDialog({ client, defaultCurrency, onOpenChange, onSaved }) {
  const editing = Boolean(client);
  const create = useCreateClient();
  const update = useUpdateClient();
  const mutation = editing ? update : create;

  const { register, handleSubmit, formState, setError, setValue, control } = useForm({
    resolver: zodResolver(
      schema.refine((v) => {
        try {
          moneyText(v.currency).parse(v.default_bill_rate);
          return true;
        } catch {
          return false;
        }
      }, { path: ['default_bill_rate'], message: 'Enter an amount like 25.500' }),
    ),
    defaultValues: {
      name: client?.name ?? '',
      code_prefix: client?.code_prefix ?? '',
      status: client?.status === 'Archived' ? 'Active' : (client?.status ?? 'Active'),
      currency: client?.currency ?? defaultCurrency,
      industry: client?.industry ?? '',
      website: client?.website ?? '',
      tax_id: client?.tax_id ?? '',
      payment_terms_days: client?.payment_terms_days ?? 30,
      billing_address: client?.billing_address ?? '',
      internal_notes: client?.internal_notes ?? '',
      default_bill_rate: minorToText(client?.default_bill_rate, client?.currency ?? defaultCurrency),
    },
  });

  // Suggest a prefix while creating, until the user types their own (D-02)
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [watchedName, watchedCurrency] = useWatch({ control, name: ['name', 'currency'] });
  const name = useDebounced(watchedName ?? '', 300);
  const suggestion = usePrefixSuggestion(name, { enabled: !editing && !prefixTouched && name.trim().length >= 2 });
  useEffect(() => {
    if (suggestion.data?.code_prefix && !prefixTouched) setValue('code_prefix', suggestion.data.code_prefix);
  }, [suggestion.data, prefixTouched, setValue]);

  const onSubmit = handleSubmit((v) => {
    const dirty = formState.dirtyFields;
    const body = {};
    for (const k of FIELDS) if (!editing || dirty[k]) body[k] = v[k];
    if (!editing || dirty.default_bill_rate || dirty.currency) body.default_bill_rate = textToMinor(v.default_bill_rate, v.currency);
    if (!body.code_prefix) delete body.code_prefix;
    if (editing && client.code_prefix_locked) delete body.code_prefix;
    if (editing && Object.keys(body).length === 0) return onOpenChange(false);
    mutation.mutate(editing ? { id: client.id, version: client.version, ...body } : body, {
      onSuccess: (saved) => {
        onSaved(saved);
        onOpenChange(false);
      },
      onError: (err) => applyFieldErrors(err, setError),
    });
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('clients.form.editTitle', { name: client.name }) : t('clients.form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          {mutation.error && !mutation.error.fields.length ? (
            <Alert variant="destructive" className="sm:col-span-2">
              {mutation.error.message}
            </Alert>
          ) : null}
          <div className="sm:col-span-2">
            <FormField label={t('clients.form.name')} error={formState.errors.name?.message}>
              <Input autoFocus {...register('name')} />
            </FormField>
          </div>
          <FormField
            label={t('clients.form.prefix')}
            error={formState.errors.code_prefix?.message}
            hint={editing && client.code_prefix_locked ? t('clients.form.prefixLocked') : t('clients.form.prefixHint')}
          >
            <Input
              maxLength={3}
              className="uppercase"
              disabled={editing && client.code_prefix_locked}
              {...register('code_prefix', { onChange: () => setPrefixTouched(true) })}
            />
          </FormField>
          <FormField label={t('clients.form.status')}>
            <Select {...register('status')}>
              {EDITABLE_CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`clientStatus.${s}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('clients.form.currency')} hint={editing ? t('clients.form.currencyLocked') : undefined}>
            <Select {...register('currency')}>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('clients.form.defaultBillRate', { currency: watchedCurrency })} error={formState.errors.default_bill_rate?.message}>
            <Input inputMode="decimal" {...register('default_bill_rate')} />
          </FormField>
          <FormField label={t('clients.form.industry')} error={formState.errors.industry?.message}>
            <Input {...register('industry')} />
          </FormField>
          <FormField label={t('clients.form.website')} error={formState.errors.website?.message}>
            <Input type="url" placeholder="https://" {...register('website')} />
          </FormField>
          <FormField label={t('clients.form.taxId')} error={formState.errors.tax_id?.message}>
            <Input {...register('tax_id')} />
          </FormField>
          <FormField label={t('clients.form.paymentTerms')} error={formState.errors.payment_terms_days?.message}>
            <Input type="number" min="0" max="365" {...register('payment_terms_days')} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('clients.form.billingAddress')}>
              <Textarea rows={2} {...register('billing_address')} />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label={t('clients.form.internalNotes')} hint={t('clients.form.internalNotesHint')}>
              <Textarea rows={3} {...register('internal_notes')} />
            </FormField>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
