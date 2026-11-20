// FR-APP-01: ask client contacts with Approve level to approve a file version or task.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMembers } from '@/api/projects';
import { useRequestApproval } from '@/api/portal';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';

/** `subject` is { file_version_id, name } or { task_id, name }. */
export function RequestApprovalDialog({ project, subject, onOpenChange }) {
  const members = useMembers(project.id);
  const request = useRequestApproval();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState([]);
  const [rule, setRule] = useState('Any');
  const [due, setDue] = useState('');
  const [message, setMessage] = useState('');
  const approvers = (members.data?.data ?? []).filter((m) => m.kind === 'contact' && m.portal_level === 'Approve' && m.portal_access);
  const toggle = (id, on) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));

  const submit = (e) => {
    e.preventDefault();
    const { name: _name, ...target } = subject;
    request.mutate(
      { ...target, approver_contact_ids: chosen, rule, due_date: due || null, message: message.trim() || null },
      { onSuccess: (a) => navigate(`/approvals/${a.id}`) },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('approvals.requestTitle', { name: subject.name })}</DialogTitle>
          <DialogDescription>{t('approvals.requestBody')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {request.error ? <Alert variant="destructive">{request.error.fields?.[0]?.message ?? request.error.message}</Alert> : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('approvals.approvers')}</legend>
            {approvers.length === 0 ? <p className="text-sm text-muted-foreground">{t('approvals.noApprovers')}</p> : null}
            {approvers.map((m) => (
              <label key={m.contact_id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={chosen.includes(m.contact_id)} onChange={(e) => toggle(m.contact_id, e.target.checked)} />
                {m.full_name} <span className="text-muted-foreground">· {m.email}</span>
              </label>
            ))}
          </fieldset>
          {chosen.length > 1 ? (
            <FormField label={t('approvals.rule')}>
              <Select value={rule} onChange={(e) => setRule(e.target.value)}>
                <option value="Any">{t('approvals.rules.Any')}</option>
                <option value="All">{t('approvals.rules.All')}</option>
              </Select>
            </FormField>
          ) : null}
          <FormField label={t('approvals.due')}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </FormField>
          <FormField label={t('approvals.message')}>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!chosen.length || request.isPending}>
              {t('approvals.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
