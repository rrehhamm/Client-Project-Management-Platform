// FR-TSK-09 List view: grouped by milestone or status, drag to reorder (FR-TSK-12),
// select for bulk actions (FR-TSK-11).
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { TASK_STATUS } from '@cpm/shared';
import { useTaskPosition } from '@/api/tasks';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { Assignees, PriorityBadge, TaskStatusBadge } from './TaskBadges';

function Row({ task, dateFormat, selected, onSelect, onOpen, sortable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !sortable });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`task-row-${task.title}`}
      className={`flex items-center gap-2 bg-background px-2 py-2 text-sm ${isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      {sortable ? (
        <button type="button" className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent" aria-label={t('tasks.dragHandle', { title: task.title })} {...attributes} {...listeners}>
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      <input type="checkbox" className="size-4 accent-primary" aria-label={t('tasks.selectTask', { title: task.title })} checked={selected} onChange={(e) => onSelect(task.id, e.target.checked)} />
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
        {task.title}
      </button>
      <span className="hidden flex-wrap items-center gap-1 sm:flex">
        {task.is_overdue ? <Badge variant="destructive">{t('tasks.overdue')}</Badge> : null}
        {task.has_inactive_assignee ? <Badge variant="warning">{t('tasks.assigneeInactive')}</Badge> : null}
        <PriorityBadge priority={task.priority} />
        {task.subtask_count ? (
          <span className="text-xs text-muted-foreground">{t('tasks.subtasks', { done: task.subtask_count - (task.open_subtask_count ?? 0), total: task.subtask_count })}</span>
        ) : null}
      </span>
      <TaskStatusBadge status={task.status} />
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{task.due_date ? formatDate(task.due_date, dateFormat) : ''}</span>
      <Assignees people={task.assignees} />
    </li>
  );
}

export function TaskListView({ tasks, groupBy, milestones, dateFormat, selected, onSelect, onOpen, canReorder }) {
  const position = useTaskPosition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const groups =
    groupBy === 'status'
      ? Object.values(TASK_STATUS).map((s) => ({ id: s, title: t(`taskStatus.${s}`), tasks: tasks.filter((x) => x.status === s) }))
      : [
          ...milestones.map((m) => ({ id: m.id, title: m.title, tasks: tasks.filter((x) => x.milestone?.id === m.id) })),
          { id: 'none', title: t('tasks.noMilestone'), tasks: tasks.filter((x) => !x.milestone) },
        ];

  const onDragEnd = (group) => (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = group.tasks.map((x) => x.id);
    const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    const at = moved.indexOf(active.id);
    position.mutate({ id: active.id, after_id: at === 0 ? null : moved[at - 1] });
  };

  return (
    <div className="space-y-6">
      {position.error ? <Alert variant="destructive">{position.error.message}</Alert> : null}
      {groups
        .filter((g) => g.tasks.length > 0)
        .map((g) => (
          <section key={g.id} aria-label={g.title}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {g.title}
              <span className="text-xs font-normal text-muted-foreground">{g.tasks.length}</span>
            </h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(g)}>
              <SortableContext items={g.tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <ul className="divide-y rounded-lg border">
                  {g.tasks.map((task) => (
                    <Row key={task.id} task={task} dateFormat={dateFormat} selected={selected.has(task.id)} onSelect={onSelect} onOpen={onOpen} sortable={canReorder} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </section>
        ))}
    </div>
  );
}
