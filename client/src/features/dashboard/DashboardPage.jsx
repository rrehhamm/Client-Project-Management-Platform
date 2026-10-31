// FR-DASH-01/02/03: a dashboard per role, built on the server from what the viewer
// may see (BR-DASH-01). Every card opens the list it counts (FR-DASH-05). While
// loading: skeletons; on error: a Retry, never zeros shown as real (FR-DASH-06).
import { Link } from 'react-router';
import { useMe } from '@/api/auth';
import { useDashboard } from '@/api/comms';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { OverdueBadge, ProjectStatusBadge } from '@/components/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';

function CountCard({ label, count, link }) {
  return (
    <Link to={link} className="rounded-lg border p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={`${t('dashboard.cardLink', { label })}: ${count}`} data-testid={`card-${label}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{count}</p>
    </Link>
  );
}

function MyProjects({ projects, dateFormat }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('dashboard.myProjects')}</CardTitle>
        {projects.total > projects.data.length ? (
          <Link to={projects.link} className="text-sm text-primary hover:underline">
            {t('dashboard.allProjects', { count: projects.total })}
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.myProjectsEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {projects.data.map((p) => (
              <li key={p.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem] sm:items-center">
                <div className="min-w-0 space-y-1">
                  <Link to={`/projects/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{p.code}</span>
                    <ProjectStatusBadge status={p.status} />
                    {p.is_overdue ? <OverdueBadge /> : null}
                    {p.due_date ? <span>{formatDate(p.due_date, dateFormat)}</span> : null}
                  </div>
                </div>
                <ProgressBar value={p.progress_pct} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{t('states.loading')}</span>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

export function DashboardPage() {
  const { data: me } = useMe();
  const query = useDashboard();
  const df = me.workspace.date_format;
  const d = query.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title', { name: me.principal.full_name })}</h1>
        {d ? <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.subtitle', { role: t(`roles.${me.principal.role}`), start: formatDate(d.week.start, df), end: formatDate(d.week.end, df) })}</p> : null}
      </div>

      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          {d.cards.length ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {d.cards.map((c) => (
                <CountCard key={c.key} label={t(`dashboard.cards.${c.key}`)} count={c.count} link={c.link} />
              ))}
            </div>
          ) : null}
          {d.my_tasks ? (
            <section aria-label={t('dashboard.myTasks')} className="space-y-3">
              <h2 className="text-lg font-semibold">{t('dashboard.myTasks')}</h2>
              {d.my_tasks.overdue + d.my_tasks.today + d.my_tasks.this_week === 0 ? (
                <EmptyState
                  body={t('dashboard.emptyMember')}
                  action={
                    <Button asChild variant="outline">
                      <Link to="/my-tasks">{t('myTasks.title')}</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {['overdue', 'today', 'this_week'].map((g) => (
                    <CountCard key={g} label={t(`dashboard.myTasksGroups.${g}`)} count={d.my_tasks[g]} link={d.my_tasks.link} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {d.my_projects ? <MyProjects projects={d.my_projects} dateFormat={df} /> : null}
        </>
      )}
    </div>
  );
}
