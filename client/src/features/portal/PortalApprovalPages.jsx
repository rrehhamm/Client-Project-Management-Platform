// FR-PORT-05 approvals in the portal: the list, and one approval with proofing and the
// decision. "Request changes" needs a note (TC-APP-001); a decision is final (BR-APP-01).
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMe } from '@/api/auth';
import { proofUrl, useAddPin, useDecide, usePortalApproval, usePortalApprovals } from '@/api/portal';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalDecisions, ApprovalStatusBadge } from '@/features/approvals/ApprovalPages';
import { ProofViewer } from '@/features/approvals/ProofViewer';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';

const nameOf = (a) => (a.subject.type === 'file' ? `${a.subject.file.name} · ${t('files.version', { n: a.subject.version_no })}` : a.subject.task.title);

export function PortalApprovalsPage() {
  const { data: me } = useMe();
  const query = usePortalApprovals();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('portal.nav.approvals')}</h1>
      {query.isPending ? (
        <LoadingState rows={4} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState body={t('portal.noApprovals')} />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {query.data.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Link to={`/portal/approvals/${a.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                {nameOf(a)}
              </Link>
              <span className="text-muted-foreground">{a.project.name}</span>
              <ApprovalStatusBadge status={a.status} />
              {a.can_decide ? <span className="text-xs font-medium text-brand-text">{t('portal.yourTurn')}</span> : null}
              {a.due_date ? <span className="text-xs text-muted-foreground">{formatDate(a.due_date, me.workspace.date_format)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisionForm({ approval }) {
  const decide = useDecide();
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState(false);
  const submit = (decision) => decide.mutate({ id: approval.id, decision, ...(note.trim() ? { note: note.trim() } : {}) });
  return (
    <section aria-label={t('portal.decide')} className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">{t('portal.decide')}</h2>
      <p className="text-sm text-muted-foreground">{t('portal.decideHint')}</p>
      <label className="grid gap-1 text-sm font-medium">
        {changes ? t('portal.changesNote') : t('portal.optionalNote')}
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-required={changes} />
      </label>
      {decide.error ? <Alert variant="destructive">{decide.error.fields?.[0]?.message ?? decide.error.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={decide.isPending} onClick={() => submit('Approved')}>
          {t('portal.approveButton')}
        </Button>
        <Button
          variant="outline"
          disabled={decide.isPending}
          onClick={() => {
            if (!changes) return setChanges(true);
            submit('ChangesRequested');
          }}
        >
          {t('portal.requestChanges')}
        </Button>
      </div>
    </section>
  );
}

export function PortalApprovalPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const query = usePortalApproval(id);
  const pin = useAddPin('/portal');
  if (query.isPending) return <LoadingState rows={5} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const a = query.data;
  const amApprover = a.approvers.some((x) => x.is_me);
  return (
    <div className="space-y-6">
      <Link to="/portal/approvals" className="text-sm text-brand-text hover:underline">
        ← {t('portal.nav.approvals')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight break-words">{nameOf(a)}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ApprovalStatusBadge status={a.status} />
          <span>{a.project.name}</span>
          {a.due_date ? <span>· {t('approvals.dueOn', { date: formatDate(a.due_date, me.workspace.date_format) })}</span> : null}
          {a.requested_by ? <span>· {t('approvals.requestedBy', { name: a.requested_by.full_name })}</span> : null}
        </div>
      </div>
      {a.message ? <p className="rounded-md bg-muted/50 p-3 text-sm">{a.message}</p> : null}
      {a.can_decide ? <DecisionForm approval={a} /> : a.my_decision ? <Alert>{t('portal.youDecided', { decision: t(`approvals.status.${a.my_decision}`) })}</Alert> : null}
      <section aria-label={t('approvals.approvers')} className="space-y-2">
        <h2 className="text-sm font-semibold">{t('approvals.approvers')}</h2>
        <ApprovalDecisions approval={a} tz={me.principal.timezone ?? me.workspace.timezone} />
      </section>
      <ProofViewer approval={a} loadUrl={() => proofUrl(a.id, '/portal')} canPin={a.status === 'Pending' && amApprover} onAddPin={(p) => pin.mutateAsync({ id: a.id, ...p })} pinPending={pin.isPending} pinError={pin.error} />
    </div>
  );
}
