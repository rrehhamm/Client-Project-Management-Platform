// FR-PRJ-02/03 (D-26): the workspace's project templates. Rename and delete; projects
// made from a template are not affected.
import { useState } from 'react';
import { useMe } from '@/api/auth';
import { useDeleteTemplate, useTemplates, useUpdateTemplate } from '@/api/templates';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';

function RenameDialog({ template, onOpenChange }) {
  const update = useUpdateTemplate();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const submit = (e) => {
    e.preventDefault();
    update.mutate({ id: template.id, version: template.version, name, description: description.trim() || null }, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.renameTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {update.error ? <Alert variant="destructive">{update.error.fields?.[0]?.message ?? update.error.message}</Alert> : null}
          <FormField label={t('templates.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </FormField>
          <FormField label={t('templates.description')}>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending || name.trim().length < 2}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesPage() {
  const { data: me } = useMe();
  const query = useTemplates();
  const remove = useDeleteTemplate();
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const canManage = me.capabilities.manage_templates;

  let body;
  if (query.isPending) body = <LoadingState rows={4} />;
  else if (query.error) body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (query.data.data.length === 0) body = <EmptyState body={t('templates.empty')} />;
  else
    body = (
      <ul className="divide-y rounded-lg border">
        {query.data.data.map((tpl) => (
          <li key={tpl.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{tpl.name}</p>
              {tpl.description ? <p className="text-sm text-muted-foreground">{tpl.description}</p> : null}
              <p className="text-xs text-muted-foreground">
                {t('templates.counts', tpl.counts)} · {t(`billingType.${tpl.billing_type}`)} · {formatDate(tpl.created_at.slice(0, 10), me.workspace.date_format)}
              </p>
            </div>
            {canManage ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRenaming(tpl)}>
                  {t('templates.rename')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDeleting(tpl)}>
                  {t('common.delete')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle')} />
      {body}
      {renaming ? <RenameDialog template={renaming} onOpenChange={(o) => !o && setRenaming(null)} /> : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('templates.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('templates.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
