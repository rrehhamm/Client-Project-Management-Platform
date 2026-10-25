// "Save as template" (FR-PRJ-02) and "Duplicate" (FR-PRJ-12) on a project page.
import { useState } from 'react';
import { useDuplicateProject, useSaveTemplate } from '@/api/templates';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';

const fieldError = (err, field) => err?.fields?.find((f) => f.field === field)?.message;

export function SaveTemplateDialog({ project, onOpenChange, onSaved }) {
  const save = useSaveTemplate();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState('');
  const submit = (e) => {
    e.preventDefault();
    save.mutate(
      { project_id: project.id, name, description: description.trim() || null },
      {
        onSuccess: (tpl) => {
          onSaved(t('templates.saved', { name: tpl.name }));
          onOpenChange(false);
        },
      },
    );
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.saveTitle', { name: project.name })}</DialogTitle>
          <DialogDescription>{t('templates.saveBody')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {save.error && !fieldError(save.error, 'name') ? <Alert variant="destructive">{save.error.message}</Alert> : null}
          <FormField label={t('templates.name')} error={fieldError(save.error, 'name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </FormField>
          <FormField label={t('templates.description')}>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {t('templates.saveAs')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateProjectDialog({ project, onOpenChange, onDone }) {
  const duplicate = useDuplicateProject();
  const [name, setName] = useState(`${project.name} (copy)`);
  const [start, setStart] = useState(project.start_date);
  const submit = (e) => {
    e.preventDefault();
    duplicate.mutate({ id: project.id, name, start_date: start || undefined }, { onSuccess: (p) => onDone(p) });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.duplicateTitle', { name: project.name })}</DialogTitle>
          <DialogDescription>{t('templates.duplicateBody')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {duplicate.error && !fieldError(duplicate.error, 'name') ? <Alert variant="destructive">{duplicate.error.message}</Alert> : null}
          <FormField label={t('templates.newName')} error={fieldError(duplicate.error, 'name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </FormField>
          <FormField label={t('templates.newStart')}>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={duplicate.isPending || name.trim().length < 2}>
              {t('templates.duplicate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
