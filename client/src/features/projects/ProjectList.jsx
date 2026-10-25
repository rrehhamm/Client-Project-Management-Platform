// Project rows as a table or cards (FR-PRJ-09). Used on the Projects page and the client's Projects tab.
import { Link } from 'react-router';
import { ProgressBar } from '@/components/ProgressBar';
import { OverdueBadge, ProjectStatusBadge } from '@/components/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';

function Flags({ p }) {
  return (
    <>
      {p.is_overdue ? <OverdueBadge /> : null}
      {p.archived_at ? <Badge variant="outline">{t('projects.archived')}</Badge> : null}
    </>
  );
}

export function ProjectList({ projects, view = 'table', dateFormat, showClient = true, onRestore }) {
  if (view === 'cards') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Card key={p.id} data-testid={`project-card-${p.code}`} className="gap-3 py-4">
            <CardHeader className="px-4">
              <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
              <CardTitle>
                <Link to={`/projects/${p.id}`} className="text-primary hover:underline">
                  {p.name}
                </Link>
              </CardTitle>
              {showClient ? <p className="text-sm text-muted-foreground">{p.client.name}</p> : null}
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <div className="flex flex-wrap gap-1">
                <ProjectStatusBadge status={p.status} />
                <Flags p={p} />
              </div>
              <ProgressBar value={p.progress_pct} />
              <p className="text-xs text-muted-foreground">
                {t('projects.columns.due')}: {formatDate(p.due_date, dateFormat)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.project')}</th>
            {showClient ? <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.client')}</th> : null}
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.status')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.pm')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.due')}</th>
            <th scope="col" className="w-40 px-4 py-3 font-medium">{t('projects.columns.progress')}</th>
            {onRestore ? <th scope="col" className="px-4 py-3"><span className="sr-only">{t('projects.restore')}</span></th> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {projects.map((p) => (
            <tr key={p.id} data-testid={`project-row-${p.code}`} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                {onRestore ? (
                  <span className="font-medium">{p.name}</span>
                ) : (
                  <Link to={`/projects/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.name}
                  </Link>
                )}
              </td>
              {showClient ? <td className="px-4 py-3 text-muted-foreground">{p.client.name}</td> : null}
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  <ProjectStatusBadge status={p.status} />
                  <Flags p={p} />
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{p.pm?.full_name ?? t('common.none')}</td>
              <td className="px-4 py-3 tabular-nums">{formatDate(p.due_date, dateFormat)}</td>
              <td className="px-4 py-3">
                <ProgressBar value={p.progress_pct} />
              </td>
              {onRestore ? (
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" onClick={() => onRestore(p)}>
                    {t('projects.restore')}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
