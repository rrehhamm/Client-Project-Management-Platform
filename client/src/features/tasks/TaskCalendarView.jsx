// FR-TSK-09 Calendar view (D-25): month grid by due date, weeks start on the workspace day.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { todayInTimeZone } from '@cpm/shared';
import { useTasks } from '@/api/tasks';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Button } from '@/components/ui/button';
import { t, tList } from '@/i18n';
import { cn } from '@/lib/utils';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

/** All days shown for a month: from the week start before the 1st to the week end after the last day. */
function monthGrid(year, month, weekStart) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const start = addDays(first, -((first.getUTCDay() - weekStart + 7) % 7));
  const end = addDays(last, (weekStart + 6 - last.getUTCDay() + 7) % 7);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function TaskCalendarView({ projectId, filters, workspace, onOpen }) {
  const today = todayInTimeZone(workspace.timezone);
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const days = monthGrid(ym.y, ym.m, workspace.week_start_day);
  const query = useTasks(projectId, { ...filters, all_levels: true, due_from: iso(days[0]), due_to: iso(days.at(-1)) });
  const dayNames = tList('settings.days');
  const weekdays = Array.from({ length: 7 }, (_, i) => dayNames[(workspace.week_start_day + i) % 7]);
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(ym.y, ym.m, 1)));
  const shift = (n) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));

  const byDay = new Map();
  for (const task of query.data?.data ?? []) {
    if (!task.due_date) continue;
    byDay.set(task.due_date, [...(byDay.get(task.due_date) ?? []), task]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('tasks.calendar.previous')} onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h3 className="min-w-40 text-center font-semibold">{title}</h3>
        <Button variant="outline" size="icon" aria-label={t('tasks.calendar.next')} onClick={() => shift(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {query.isPending ? (
        <LoadingState rows={4} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[42rem] grid-cols-7 rounded-lg border text-xs" role="grid" aria-label={title}>
            {weekdays.map((d) => (
              <div key={d} role="columnheader" className="border-b bg-muted/50 px-2 py-1 font-medium">
                {d.slice(0, 3)}
              </div>
            ))}
            {days.map((d) => {
              const key = iso(d);
              const inMonth = d.getUTCMonth() === ym.m;
              const items = byDay.get(key) ?? [];
              return (
                <div key={key} role="gridcell" data-testid={`day-${key}`} className={cn('min-h-24 border-b border-r p-1', !inMonth && 'bg-muted/30 text-muted-foreground')}>
                  <div className={cn('mb-1 text-right', key === today && 'font-bold text-primary')}>
                    {d.getUTCDate()}
                    {key === today ? <span className="sr-only"> ({t('tasks.calendar.today')})</span> : null}
                  </div>
                  <ul className="space-y-1">
                    {items.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(task.id)}
                          className={cn('w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent', task.status === 'Done' ? 'line-through opacity-60' : task.is_overdue ? 'bg-destructive/10' : 'bg-primary/10')}
                        >
                          {task.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
