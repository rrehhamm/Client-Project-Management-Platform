// Changing a task's status, with the BR-TSK-02 prompt: a parent with open subtasks
// can only be completed by also completing them (TC-TSK-002).
import { useState } from 'react';
import { useChangeTaskStatus } from '@/api/tasks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { t } from '@/i18n';

export function useStatusChange() {
  const change = useChangeTaskStatus();
  const [prompt, setPrompt] = useState(null); // { task, status, titles }

  const run = (task, status) =>
    change.mutate(
      { id: task.id, status, version: task.version },
      {
        onError: (err) => {
          const open = err.fields?.filter((f) => f.field === 'subtasks') ?? [];
          if (open.length) setPrompt({ task, status, titles: open.map((f) => f.message) });
        },
      },
    );

  const dialog = (
    <ConfirmDialog
      open={Boolean(prompt)}
      onOpenChange={(o) => !o && setPrompt(null)}
      title={t('tasks.panel.completeSubtasks')}
      description={prompt?.titles.join(', ')}
      confirmLabel={t('tasks.panel.completeAll')}
      pending={change.isPending}
      onConfirm={() =>
        change.mutate({ id: prompt.task.id, status: prompt.status, version: prompt.task.version, complete_subtasks: true }, { onSettled: () => setPrompt(null) })
      }
    />
  );

  // The subtask conflict is answered by the dialog, so it is not shown as an error too
  const error = prompt || change.error?.fields?.some((f) => f.field === 'subtasks') ? null : change.error;
  return { run, dialog, error, isPending: change.isPending };
}
