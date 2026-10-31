// FR-DASH-05: the list a task card opens. It sends the card's own query parameters to
// the server, so the total here equals the number on the card (TC-DASH-001).
import { Link, useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useWorkTasks } from '@/api/comms';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Assignees, TaskStatusBadge } from '@/features/tasks/TaskBadges';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';

const KEYS = ['due', 'status', 'mine', 'inactive_assignee', 'open'];

export function WorkTasksPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k)]));
  const page = Number(params.get('page')) || 1;
  const query = useWorkTasks({ ...filters, page, page_size: 50 });
  const df = me.workspace.date_format;

  const chip = (k) => {
    if (k === 'due') return t(`work.filters.due.${filters.due}`);
    if (k === 'status') return t('work.filters.status', { status: t(`taskStatus.${filters.status}`) });
    return t(`work.filters.${k}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('work.title')} subtitle={t('work.subtitle')} />
      {Object.keys(filters).length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {Object.keys(filters).map((k) => (
            <span key={k} className="rounded-full bg-muted px-3 py-1">
              {chip(k)}
            </span>
          ))}
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
        <EmptyState body={t('work.empty')} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="work-total">
            {t('work.total', { count: query.data.total })}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {['task', 'project', 'status', 'due', 'assignees'].map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-medium">
                      {t(`work.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {query.data.data.map((task) => (
                  <tr key={task.id}>
                    <td className="px-3 py-2">
                      <Link to={`/projects/${task.project.id}?tab=tasks&task=${task.id}`} className="font-medium hover:underline">
                        {task.title}
                      </Link>
                      {task.parent ? <div className="text-xs text-muted-foreground">↳ {task.parent.title}</div> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{task.project.code}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        <TaskStatusBadge status={task.status} />
                        {task.is_overdue ? <Badge variant="destructive">{t('tasks.overdue')}</Badge> : null}
                        {task.has_inactive_assignee ? <Badge variant="warning">{t('tasks.assigneeInactive')}</Badge> : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{task.due_date ? formatDate(task.due_date, df) : ''}</td>
                    <td className="px-3 py-2">
                      <Assignees people={task.assignees} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={50}
            total={query.data.total}
            onPage={(p) =>
              setParams((x) => {
                const c = new URLSearchParams(x);
                c.set('page', String(p));
                return c;
              })
            }
          />
        </>
      )}
    </div>
  );
}
