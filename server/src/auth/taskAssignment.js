// D-24 assignment rule, next to can() so the decision stays in the auth layer.
// PM/Admin/Owner may change anyone's assignment. Team Members may add themselves,
// and remove themselves only from tasks they created or self-assigned.
import { can } from './can.js';

/**
 * @param {object} principal
 * @param {object} ctx  task ctx (project, membership, record)
 * @param {Array<{user_id: string, created_by: string|null}>} current  assignee rows
 * @param {string[]} next  requested assignee ids
 * @returns {string|null} null when allowed, otherwise the reason
 */
export function assignmentChangeProblem(principal, ctx, current, next) {
  if (can(principal, 'task.assignOthers', ctx)) return null;
  const before = new Set(current.map((a) => a.user_id));
  const after = new Set(next);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  if ([...added, ...removed].some((id) => id !== principal.id)) {
    return "Only the project's PM, an Admin or the Owner can change other people's assignment";
  }
  if (added.length && !can(principal, 'task.assignSelf', ctx)) return 'You cannot assign yourself to this task';
  if (removed.length) {
    const mine = current.find((a) => a.user_id === principal.id);
    const selfAssigned = mine?.created_by === principal.id;
    const ownTask = ctx.record?.created_by === principal.id;
    if (!selfAssigned && !ownTask) return 'Ask the project manager to reassign this task';
  }
  return null;
}
