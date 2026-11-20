// Internal approval screens: one approval with proofing (FR-APP-02/05/06) and the list
// the dashboard cards open (FR-DASH-05, D-33). Internal users never decide (BR-APP-02).
import { Link, useParams, useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { proofUrl, useAddPin, useApproval, useApprovals, useCancelApproval } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/format';
import { ProofViewer } from './ProofViewer';

const VARIANT = { Pending: 'warning', Approved: 'success', ChangesRequested: 'destructive', Cancelled: 'outline', Superseded: 'secondary' };
export const ApprovalStatusBadge = ({ status }) => <Badge variant={VARIANT[status]}>{t(`approvals.status.${status}`)}</Badge>;

const subjectName = (a) => (a.subject.type === 'file' ? `${a.subject.file.name} · ${t('files.version', { n: a.subject.version_no })}` : a.subject.task.title);

export function ApprovalDecisions({ approval, tz }) {
  return (
    <ul className="divide-y rounded-md border text-sm">
      {approval.approvers.map((x) => (
        <li key={x.contact_id ?? x.full_name} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="font-medium">{x.full_name}</span>
          {x.decision ? <ApprovalStatusBadge status={x.decision} /> : <span className="text-muted-foreground">{t('approvals.waiting')}</span>}
          {x.decided_at ? <time className="text-xs text-muted-foreground">{formatDateTime(x.decided_at, tz)}</time> : null}
          {x.decision_note ? <p className="w-full text-muted-foreground">“{x.decision_note}”</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function ApprovalPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const query = useApproval(id);
  const cancel = useCancelApproval();
  const pin = useAddPin('');
  const tz = me.principal.timezone ?? me.workspace.timezone;
  if (query.isPending) return <LoadingState rows={6} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const a = query.data;
  return (
    <div className="space-y-6">
      <Link to={`/projects/${a.project.id}?tab=${a.subject.type === 'file' ? `files&file=${a.subject.file.id}` : `tasks&task=${a.subject.task.id}`}`} className="text-sm text-primary hover:underline">
        ← {a.project.code} · {a.project.name}
      </Link>
      <PageHeader
        title={subjectName(a)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ApprovalStatusBadge status={a.status} />
            <span>{t(`approvals.rules.${a.rule}`)}</span>
            {a.due_date ? <span>· {t('approvals.dueOn', { date: formatDate(a.due_date, me.workspace.date_format) })}</span> : null}
            {a.requested_by ? <span>· {t('approvals.requestedBy', { name: a.requested_by.full_name })}</span> : null}
          </span>
        }
        actions={
          a.permissions?.cancel ? (
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
              {t('approvals.cancel')}
            </Button>
          ) : null
        }
      />
      {cancel.error ? <Alert variant="destructive">{cancel.error.message}</Alert> : null}
      {a.message ? <p className="rounded-md bg-muted/50 p-3 text-sm">{a.message}</p> : null}
      <section className="space-y-2" aria-label={t('approvals.approvers')}>
        <h2 className="text-sm font-semibold">{t('approvals.approvers')}</h2>
        <ApprovalDecisions approval={a} tz={tz} />
        <p className="text-xs text-muted-foreground">{t('approvals.onlyClients')}</p>
      </section>
      <ProofViewer approval={a} loadUrl={() => proofUrl(a.id)} canPin={Boolean(a.permissions?.pin)} onAddPin={(p) => pin.mutateAsync({ id: a.id, ...p })} pinPending={pin.isPending} pinError={pin.error} />
    </div>
  );
}

export function ApprovalsPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || undefined;
  const mine = params.get('mine') === 'true' || undefined;
  const page = Number(params.get('page')) || 1;
  const query = useApprovals({ status, mine, page, page_size: 50 });
  return (
    <div className="space-y-6">
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      {status || mine ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {status ? <span className="rounded-full bg-muted px-3 py-1">{t(`approvals.status.${status}`)}</span> : null}
          {mine ? <span className="rounded-full bg-muted px-3 py-1">{t('work.filters.mine')}</span> : null}
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            {t('common.clearFilter')}
          </Button>
        </div>
      ) : null}
      {query.isPending ? (
        <LoadingState rows={5} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState body={t('approvals.empty')} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('approvals.total', { count: query.data.total })}</p>
          <ul className="divide-y rounded-lg border">
            {query.data.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link to={`/approvals/${a.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {subjectName(a)}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">{a.project.code}</span>
                <ApprovalStatusBadge status={a.status} />
                <span className="text-xs text-muted-foreground">{a.due_date ? formatDate(a.due_date, me.workspace.date_format) : ''}</span>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={50} total={query.data.total} onPage={(p) => setParams((x) => { const c = new URLSearchParams(x); c.set('page', String(p)); return c; })} />
        </>
      )}
    </div>
  );
}

/** FR-APP-05: every round for one file, in the file dialog. */
export function FileApprovalHistory({ fileId }) {
  const { data: me } = useMe();
  const query = useApprovals({ file_id: fileId, page_size: 50 });
  const rows = query.data?.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="space-y-2" aria-label={t('approvals.history')}>
      <h3 className="text-sm font-semibold">{t('approvals.history')}</h3>
      <ul className="divide-y rounded-md border text-sm">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Link to={`/approvals/${a.id}`} className="font-medium hover:underline">
              {t('files.version', { n: a.subject.version_no })}
            </Link>
            <ApprovalStatusBadge status={a.status} />
            <span className="text-xs text-muted-foreground">{formatDateTime(a.created_at, me.principal.timezone ?? me.workspace.timezone)}</span>
            {a.decision_note ? <span className="w-full text-muted-foreground">“{a.decision_note}”</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
