// FR-TSK-09 Board view: a column per status; dragging a card changes its status (TC-TSK-006).
// Each card also has a status menu, so the board works without a mouse.
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { TASK_STATUS, allowedTaskTargets, taskTransition } from '@cpm/shared';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Assignees, PriorityBadge } from './TaskBadges';
import { useStatusChange } from './useStatusChange';

function Card({ task, dateFormat, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { task } });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      data-testid={`task-card-${task.title}`}
      className={cn('rounded-md border bg-card p-3 text-sm shadow-xs', isDragging && 'relative z-20 shadow-lg')}
    >
      <div className="flex items-start gap-1">
        <button type="button" className="-ml-1 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label={t('tasks.dragCard', { title: task.title })} {...listeners} {...attributes}>
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left font-medium hover:underline">
          {task.title}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {task.is_overdue ? <Badge variant="destructive">{t('tasks.overdue')}</Badge> : null}
        <PriorityBadge priority={task.priority} />
        {task.due_date ? <span className="text-xs text-muted-foreground">{formatDate(task.due_date, dateFormat)}</span> : null}
        <span className="ml-auto">
          <Assignees people={task.assignees} max={2} />
        </span>
      </div>
      <select
        aria-label={t('tasks.moveTo', { title: task.title })}
        className="mt-2 w-full rounded border bg-background px-1 py-0.5 text-xs"
        value=""
        onChange={(e) => e.target.value && onMove(task, e.target.value)}
      >
        <option value="">{t('tasks.moveTo', { title: '' }).trim()}…</option>
        {allowedTaskTargets(task.status).map((s) => (
          <option key={s} value={s}>
            {t(`taskStatus.${s}`)}
          </option>
        ))}
      </select>
    </li>
  );
}

function Column({ status, tasks, dateFormat, onOpen, onMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={t(`taskStatus.${status}`)} data-testid={`column-${status}`} className={cn('flex w-64 shrink-0 flex-col rounded-lg bg-muted/50 p-2', isOver && 'ring-2 ring-primary')}>
      <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
        {t(`taskStatus.${status}`)}
        <span className="text-xs font-normal text-muted-foreground">{tasks.length}</span>
      </h3>
      <ul className="flex min-h-16 flex-col gap-2">
        {tasks.map((task) => (
          <Card key={task.id} task={task} dateFormat={dateFormat} onOpen={onOpen} onMove={onMove} />
        ))}
      </ul>
    </section>
  );
}

export function TaskBoardView({ tasks, dateFormat, onOpen }) {
  const change = useStatusChange();
  const [localError, setLocalError] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const move = (task, status) => {
    setLocalError(null);
    if (task.status === status) return;
    if (!taskTransition(task.status, status)) return setLocalError(t('tasks.notAllowed'));
    change.run(task, status);
  };

  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    move(active.data.current.task, over.id);
  };

  const error = localError ?? change.error?.message;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('tasks.boardHint')}</p>
      <div aria-live="polite">{error ? <Alert variant="destructive">{error}</Alert> : null}</div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Object.values(TASK_STATUS).map((s) => (
            <Column key={s} status={s} tasks={tasks.filter((x) => x.status === s)} dateFormat={dateFormat} onOpen={onOpen} onMove={move} />
          ))}
        </div>
      </DndContext>
      {change.dialog}
    </div>
  );
}
