import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const STATUS_VARIANT = { ToDo: 'secondary', InProgress: 'default', InReview: 'warning', Blocked: 'destructive', Done: 'success', Cancelled: 'outline' };
const PRIORITY_VARIANT = { Low: 'outline', Normal: 'secondary', High: 'warning', Urgent: 'destructive' };

export const TaskStatusBadge = ({ status }) => <Badge variant={STATUS_VARIANT[status]}>{t(`taskStatus.${status}`)}</Badge>;
export const PriorityBadge = ({ priority }) => (priority === 'Normal' ? null : <Badge variant={PRIORITY_VARIANT[priority]}>{t(`priority.${priority}`)}</Badge>);

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/** Assignee initials; inactive people are struck through and named in the tooltip. */
export function Assignees({ people, max = 3 }) {
  if (!people?.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className="flex -space-x-1.5" aria-label={people.map((p) => p.full_name).join(', ')}>
      {shown.map((p) => (
        <span
          key={p.id ?? p.full_name}
          title={p.status && p.status !== 'Active' ? `${p.full_name} (${t('tasks.assigneeInactive')})` : p.full_name}
          className={cn(
            'flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold',
            p.status && p.status !== 'Active' && 'line-through opacity-60',
          )}
        >
          {initials(p.full_name)}
        </span>
      ))}
      {people.length > max ? <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px]">+{people.length - max}</span> : null}
    </span>
  );
}
