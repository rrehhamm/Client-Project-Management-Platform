// Dashboards: FR-DASH-01/02/03/05, BR-DASH-01/02, D-33.
// Every number is computed here on the viewer's permitted data (BR-DASH-01), with the
// same filter its drill-down list uses (FR-DASH-05): a card links to that list with
// the same query parameters, so card count = list total (TC-DASH-001).
import { PROJECT_STATUS, ROLES, projectListQuerySchema, workTaskQuerySchema } from '@cpm/shared';
import { workspaceWeek } from '../../lib/dates.js';
import { db } from '../../lib/db.js';
import { projectInclude, toProjectDto } from '../projects/common.js';
import { projectListWhere } from '../projects/service.js';
import { myTasks, workTaskWhere } from '../tasks/service.js';

const CLOSED = [PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED];
const qs = (params) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export async function dashboard(viewer) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id }, select: { timezone: true, week_start_day: true } });
  const week = workspaceWeek(ws);

  const projectCard = async (key, params) => ({
    key,
    count: await db.project.count({ where: projectListWhere(viewer, projectListQuerySchema.parse(params), week.today) }),
    link: `/projects?${qs(params)}`,
  });
  const taskCard = async (key, params) => ({
    key,
    count: await db.task.count({ where: workTaskWhere(viewer, workTaskQuerySchema.parse(params), week) }),
    link: `/work?${qs(params)}`,
  });

  const out = { view: null, week: { start: week.weekStart, end: week.weekEnd, today: week.today }, cards: [] };

  if ([ROLES.OWNER, ROLES.ADMIN, ROLES.FINANCE].includes(viewer.role)) {
    // FR-DASH-01 (Finance sees the same until its own dashboard, FR-DASH-04, D-32)
    out.view = 'workspace';
    out.cards = await Promise.all([
      projectCard('active_projects', { status: PROJECT_STATUS.IN_PROGRESS }),
      projectCard('overdue_projects', { overdue: 'true' }),
      taskCard('tasks_due_this_week', { due: 'this_week' }),
    ]);
    return out;
  }

  if (viewer.role === ROLES.PM) {
    // FR-DASH-02
    out.view = 'pm';
    out.cards = await Promise.all([
      projectCard('my_overdue_projects', { pm_user_id: viewer.id, overdue: 'true' }),
      taskCard('tasks_awaiting_review', { mine: 'true', status: 'InReview' }),
      taskCard('inactive_assignees', { mine: 'true', inactive_assignee: 'true' }),
    ]);
    out.my_projects = await projectList(viewer, { pm_user_id: viewer.id, sort: 'due_date', order: 'asc' }, week.today);
    return out;
  }

  // FR-DASH-03 Team Member
  out.view = 'member';
  const mine = await myTasks(viewer);
  out.my_tasks = { overdue: mine.overdue.total, today: mine.today.total, this_week: mine.this_week.total, link: '/my-tasks' };
  out.my_projects = await projectList(viewer, { member_id: viewer.id, sort: 'due_date', order: 'asc' }, week.today);
  return out;
}

/** "My projects": open projects with status, progress and the overdue flag (budget % arrives in Phase 6, D-33). */
async function projectList(viewer, params, today) {
  const q = projectListQuerySchema.parse({ ...params, page_size: 20 });
  const where = { AND: [projectListWhere(viewer, q, today), { status: { notIn: CLOSED } }] };
  const [rows, total] = await Promise.all([
    db.project.findMany({ where, include: projectInclude, orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: q.page_size }),
    db.project.count({ where }),
  ]);
  return { data: rows.map((p) => toProjectDto(p, viewer, { today })), total, link: `/projects?${qs(params)}` };
}
