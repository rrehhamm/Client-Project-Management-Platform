// FR-PORT-01 portal home: active projects with progress, items awaiting the contact,
// recent updates. Documents and billing arrive with invoices (Phase 7).
import { Link } from 'react-router';
import { useMe } from '@/api/auth';
import { usePortalHome } from '@/api/portal';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { ProjectStatusBadge } from '@/components/StatusBadges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/format';

export function PortalHomePage() {
  const { data: me } = useMe();
  const query = usePortalHome();
  const df = me.workspace.date_format;
  const tz = me.principal.timezone ?? me.workspace.timezone;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.title', { name: me.principal.full_name })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('portal.subtitle', { client: me.principal.client.name })}</p>
      </div>
      {query.isPending ? (
        <LoadingState rows={4} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('portal.awaiting')}</CardTitle>
            </CardHeader>
            <CardContent>
              {query.data.awaiting.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('portal.nothingAwaiting')}</p>
              ) : (
                <ul className="divide-y">
                  {query.data.awaiting.approvals.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <Link to={`/portal/approvals/${a.id}`} className="font-medium text-primary hover:underline">
                        {t('portal.approve', { name: a.subject.file?.name ?? a.subject.task?.title })}
                      </Link>
                      <span className="text-muted-foreground">{a.project.name}</span>
                      {a.due_date ? <span className="text-xs text-muted-foreground">· {t('approvals.dueOn', { date: formatDate(a.due_date, df) })}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <section aria-label={t('portal.projects')} className="space-y-3">
            <h2 className="text-lg font-semibold">{t('portal.projects')}</h2>
            {query.data.projects.length === 0 ? (
              <EmptyState body={t('portal.noProjects')} />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {query.data.projects.map((p) => (
                  <li key={p.id} className="rounded-lg border p-4">
                    <Link to={`/portal/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{p.code}</span>
                      <ProjectStatusBadge status={p.status} />
                      {p.due_date ? <span>{t('portal.due', { date: formatDate(p.due_date, df) })}</span> : null}
                    </div>
                    <div className="mt-3">
                      <ProgressBar value={p.progress_pct} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>{t('portal.updates')}</CardTitle>
            </CardHeader>
            <CardContent>
              {query.data.updates.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('portal.noUpdates')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {query.data.updates.map((u, i) => (
                    <li key={i} className="flex flex-wrap gap-2">
                      <Link to={u.link} className="hover:underline">
                        {u.title}
                      </Link>
                      <span className="text-muted-foreground">· {u.project.name}</span>
                      <time className="text-xs text-muted-foreground">{formatDateTime(u.at, tz)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
