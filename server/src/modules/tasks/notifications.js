// Task notifications (FR-NOT-02, FR-NOT-05, FR-TSK-02): creators and assignees
// follow the task; new assignees are told; followers hear about status changes.
import { follow, followersOf, notify } from '../../lib/notify.js';

const link = (task) => `/projects/${task.project_id}?tab=tasks&task=${task.id}`;
const STATUS_LABEL = { ToDo: 'To do', InProgress: 'In progress', InReview: 'In review', Done: 'Done', Blocked: 'Blocked', Cancelled: 'Cancelled' };

/** The creator follows a new task. */
export function followNewTask(tx, task, viewer) {
  return follow(tx, { workspaceId: task.workspace_id, entityType: 'Task', entityId: task.id, userIds: [viewer.id], actorId: viewer.id });
}

/** New assignees follow the task and are notified (never about assigning themselves, BR-NOT-01). */
export async function taskAssigned(tx, { task, project, userIds, viewer }) {
  if (!userIds.length) return;
  await follow(tx, { workspaceId: task.workspace_id, entityType: 'Task', entityId: task.id, userIds, actorId: viewer.id });
  await notify(tx, {
    workspaceId: task.workspace_id,
    event: 'task_assigned',
    actorId: viewer.id,
    userIds,
    internal: true,
    entityType: 'Task',
    entityId: task.id,
    payload: {
      title: `${viewer.full_name} assigned you "${task.title}"`,
      subject: `Assigned to you: ${task.title}`,
      text: `${viewer.full_name} assigned you "${task.title}" in ${project.code} · ${project.name}.`,
      link: link(task),
      actor_name: viewer.full_name,
      project_code: project.code,
    },
  });
}

/** Followers hear about a status change (FR-NOT-02 "status change of followed task"). */
export async function taskStatusChanged(tx, { task, project, from, to, viewer }) {
  const followers = await followersOf('Task', task.id, tx);
  await notify(tx, {
    workspaceId: task.workspace_id,
    event: 'followed_task_status',
    actorId: viewer.id,
    userIds: followers.userIds,
    contactIds: followers.contactIds,
    internal: task.visibility !== 'Client', // BR-TSK-06: contacts only hear about Client-visible tasks
    entityType: 'Task',
    entityId: task.id,
    payload: {
      title: `${viewer.full_name} moved "${task.title}" to ${STATUS_LABEL[to] ?? to}`,
      subject: `${task.title}: ${STATUS_LABEL[to] ?? to}`,
      text: `${viewer.full_name} moved "${task.title}" (${project.code}) from ${STATUS_LABEL[from] ?? from} to ${STATUS_LABEL[to] ?? to}.`,
      link: link(task),
      actor_name: viewer.full_name,
      project_code: project.code,
    },
  });
}
