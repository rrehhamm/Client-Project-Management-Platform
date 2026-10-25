// FR-TSK-15 My Tasks: open tasks assigned to me across projects, by due date.
import { Link } from 'react-router';
import { useMe } from '@/api/auth';
import { useMyTasks } from '@/api/tasks';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { PriorityBadge, TaskStatusBadge } from './TaskBadges';

const GROUPS = ['overdue', 'today', 'this_week', 'later'];

export function MyTasksPage() {
  const { data: me } = useMe();
  const query = useMyTasks();
  const df = me.workspace.date_format;

  let body;
  if (query.isPending) body = <LoadingState rows={5} />;
  else if (query.error) body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (GROUPS.every((g) => query.data[g].total === 0)) body = <EmptyState body={t('myTasks.empty')} />;
  else
    body = GROUPS.map((g) => {
      const group = query.data[g];
      return (
        <section key={g} aria-labelledby={`my-${g}`} className="space-y-2">
          <h2 id={`my-${g}`} className="flex items-center gap-2 text-base font-semibold">
            {t(`myTasks.groups.${g}`)}
            <span className="text-sm font-normal text-muted-foreground">{group.total}</span>
          </h2>
          {group.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t('myTasks.groupEmpty')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {group.data.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Link to={`/projects/${task.project.id}?tab=tasks&task=${task.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {task.title}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">{task.project.code}</span>
                  {task.is_overdue ? <Badge variant="destructive">{t('tasks.overdue')}</Badge> : null}
                  <PriorityBadge priority={task.priority} />
                  <TaskStatusBadge status={task.status} />
                  <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{task.due_date ? formatDate(task.due_date, df) : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {group.total > group.data.length ? <p className="text-xs text-muted-foreground">{t('myTasks.more', { count: group.total - group.data.length })}</p> : null}
        </section>
      );
    });

  return (
    <div className="space-y-6">
      <PageHeader title={t('myTasks.title')} subtitle={t('myTasks.subtitle')} />
      {body}
    </div>
  );
}
