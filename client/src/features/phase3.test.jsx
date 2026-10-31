// UI checks for Phase 3 screens: tasks, My Tasks and templates. The API enforces the
// same rules; these tests check what each role is shown and what the UI sends.
import { todayInTimeZone } from '@cpm/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const WS_PUBLIC = { id: 'w1', name: 'Nexa', logo_url: null, brand_color: '#2563EB', timezone: 'Asia/Amman', currency: 'JOD', date_format: 'DD/MM/YYYY', week_start_day: 0 };
const TODAY = todayInTimeZone('Asia/Amman');

const PM_PERMS = { update: true, delete: false, manage_members: true, manage_milestones: true, create_task: true, manage_tasks: true, assign_self: true, save_template: true, duplicate: true };
const MEMBER_PERMS = { update: false, delete: false, manage_members: false, manage_milestones: false, create_task: true, manage_tasks: false, assign_self: true, save_template: false, duplicate: false };

const project = (permissions) => ({
  id: 'p-a',
  code: 'NOV-001',
  name: 'E-Commerce Platform',
  description: null,
  client: { id: 'c-nova', name: 'Nova Retail' },
  status: 'InProgress',
  start_date: '2026-10-01',
  due_date: '2027-01-31',
  billing_type: 'Fixed',
  progress_pct: 40,
  pm: { id: 'id-PM', full_name: 'Lina', status: 'Active' },
  portal_enabled: true,
  is_overdue: false,
  archived_at: null,
  version: 3,
  task_summary: { ToDo: 2, InProgress: 0, InReview: 0, Done: 0, Blocked: 0, Cancelled: 0 },
  milestone_summary: { Upcoming: 1, InProgress: 0, Completed: 0 },
  member_count: 3,
  allowed_transitions: ['OnHold', 'Completed', 'Cancelled'],
  permissions,
});

const MILESTONE = { id: 'm1', title: 'Design', status: 'Upcoming', due_date: '2026-11-30', is_overdue: false };

const task = (over) => ({
  id: 't1',
  project_id: 'p-a',
  parent_task_id: null,
  milestone: { id: 'm1', title: 'Design' },
  title: 'Wireframes',
  description: null,
  status: 'ToDo',
  priority: 'High',
  start_date: null,
  due_date: '2026-10-20',
  estimate_minutes: 120,
  visibility: 'Internal',
  is_billable: null,
  labels: [],
  assignees: [{ id: 'id-TeamMember', full_name: 'Omar Haddad', status: 'Active', self_assigned: false }],
  has_inactive_assignee: false,
  is_overdue: true,
  subtask_count: 0,
  open_subtask_count: 0,
  checklist_total: 0,
  checklist_done: 0,
  created_by: 'id-PM',
  created_at: '2026-10-02T08:00:00.000Z',
  version: 1,
  ...over,
});

const TASKS = [task(), task({ id: 't2', title: 'Checkout flow', milestone: null, priority: 'Normal', due_date: null, is_overdue: false, assignees: [] })];
const MEMBERS = {
  data: [
    { id: 'pm1', kind: 'user', user_id: 'id-PM', full_name: 'Lina', status: 'Active' },
    { id: 'pm2', kind: 'user', user_id: 'id-TeamMember', full_name: 'Omar Haddad', status: 'Active' },
  ],
};
const list = (data) => ({ data, page: 1, page_size: 100, total: data.length });

function api(role, permissions, extra = {}) {
  const fetch = mockApi({
    'GET /api/v1/auth/me': [200, meFor(role)],
    'GET /api/v1/workspace': [200, WS_PUBLIC],
    'GET /api/v1/projects/p-a': [200, project(permissions)],
    'GET /api/v1/projects/p-a/tasks': [200, list(TASKS)],
    'GET /api/v1/projects/p-a/milestones': [200, { data: [MILESTONE] }],
    'GET /api/v1/projects/p-a/members': [200, MEMBERS],
    'GET /api/v1/projects/p-a/labels': [200, { data: [] }],
    'GET /api/v1/projects': [200, list([])],
    'GET /api/v1/templates': [200, { data: [] }],
    ...extra,
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const sent = (fetch, key) =>
  fetch.mock.calls.filter(([url, init = {}]) => `${init.method ?? 'GET'} ${String(url).split('?')[0]}` === key).map(([, init]) => JSON.parse(init.body ?? 'null'));

describe('Project tasks (FR-TSK-09)', () => {
  it('lists tasks grouped by milestone with overdue and priority badges', async () => {
    api('PM', PM_PERMS);
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    const design = await screen.findByRole('region', { name: 'Design' });
    const row = within(design).getByTestId('task-row-Wireframes');
    expect(within(row).getByText('Overdue')).toBeInTheDocument();
    expect(within(row).getByText('High')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No milestone' })).getByText('Checkout flow')).toBeInTheDocument();
    // PMs can drag to reorder (FR-TSK-12)
    expect(screen.getByRole('button', { name: 'Drag to reorder Wireframes' })).toBeInTheDocument();
  });

  it('quick add creates a task in the project', async () => {
    const fetch = api('PM', PM_PERMS, { 'POST /api/v1/projects/p-a/tasks': [201, task({ id: 't3', title: 'Logo' })] });
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    fireEvent.change(await screen.findByRole('textbox', { name: 'New task title' }), { target: { value: 'Logo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(sent(fetch, 'POST /api/v1/projects/p-a/tasks')).toEqual([{ title: 'Logo' }]));
  });

  it('a Team Member sees no reorder handles or bulk bar actions for others (D-24)', async () => {
    api('TeamMember', MEMBER_PERMS);
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    await screen.findByTestId('task-row-Wireframes');
    expect(screen.queryByRole('button', { name: /Drag to reorder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('selecting tasks shows the bulk bar and sends one bulk request (FR-TSK-11)', async () => {
    const fetch = api('PM', PM_PERMS, { 'POST /api/v1/tasks/bulk': [200, { results: [], succeeded: 2, failed: 0 }] });
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Wireframes' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Checkout flow' }));
    const bar = screen.getByRole('region', { name: '2 selected' });
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Set status' }), { target: { value: 'InProgress' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(sent(fetch, 'POST /api/v1/tasks/bulk')).toEqual([{ task_ids: ['t1', 't2'], action: 'status', status: 'InProgress' }]));
    expect(await within(bar).findByText('2 updated, 0 not changed.')).toBeInTheDocument();
  });

  it('shows the empty state when the project has no tasks', async () => {
    api('PM', PM_PERMS, { 'GET /api/v1/projects/p-a/tasks': [200, list([])] });
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument();
  });

  it('shows an error state when tasks fail to load', async () => {
    api('PM', PM_PERMS, { 'GET /api/v1/projects/p-a/tasks': [500, { code: 'INTERNAL', message: 'Something went wrong', fields: [] }] });
    renderRoutes(routes, '/projects/p-a?tab=tasks');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Board view (TC-TSK-006, BR-TSK-02)', () => {
  it('moving a card with open subtasks asks to complete them all', async () => {
    let calls = 0;
    const fetch = api('PM', PM_PERMS, {
      'POST /api/v1/tasks/t1/status': () => {
        calls += 1;
        return calls === 1
          ? [409, { code: 'CONFLICT', message: 'Close the open subtasks first, or complete them all', fields: [{ field: 'subtasks', message: 'Mobile layout' }] }]
          : [200, task({ status: 'Done', version: 2 })];
      },
    });
    renderRoutes(routes, '/projects/p-a?tab=tasks&view=board');
    const card = await screen.findByTestId('task-card-Wireframes');
    expect(within(screen.getByTestId('column-ToDo')).getByText('Wireframes')).toBeInTheDocument();
    fireEvent.change(within(card).getByRole('combobox', { name: 'Move Wireframes to' }), { target: { value: 'Done' } });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Mobile layout')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete all' }));
    await waitFor(() =>
      expect(sent(fetch, 'POST /api/v1/tasks/t1/status')).toEqual([
        { status: 'Done', version: 1 },
        { status: 'Done', version: 1, complete_subtasks: true },
      ]),
    );
  });
});

describe('Calendar view (D-25)', () => {
  it('shows tasks on their due day', async () => {
    api('PM', PM_PERMS, { 'GET /api/v1/projects/p-a/tasks': [200, list([task({ due_date: TODAY, is_overdue: false })])] });
    renderRoutes(routes, '/projects/p-a?tab=tasks&view=calendar');
    const day = await screen.findByTestId(`day-${TODAY}`);
    expect(await within(day).findByRole('button', { name: 'Wireframes' })).toBeInTheDocument();
  });
});

describe('Task panel (D-24)', () => {
  const detail = (permissions, over) => ({ ...task(over), permissions, subtasks: [], checklist: [], predecessors: [], successors: [] });
  const MEMBER_TASK_PERMS = {
    edit_work: true,
    edit_details: false,
    change_visibility: false,
    change_milestone: false,
    change_billable: false,
    assign_others: false,
    assign_self: true,
    reopen: false,
    delete: false,
    move: false,
    manage_dependencies: false,
  };

  it('a Team Member on an assigned task can change status but not title, priority or visibility', async () => {
    api('TeamMember', MEMBER_PERMS, { 'GET /api/v1/tasks/t1': [200, detail(MEMBER_TASK_PERMS)] });
    renderRoutes(routes, '/projects/p-a?tab=tasks&task=t1');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Status');
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Priority')).toBeDisabled();
    expect(within(dialog).getByLabelText('Visibility')).toBeDisabled();
    expect(within(dialog).getByLabelText('Billable')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument();
    // Assigned by the PM, so they cannot remove themselves (D-24)
    expect(within(dialog).queryByRole('button', { name: 'Remove Omar Haddad' })).not.toBeInTheDocument();
  });

  it('"Assign me" adds the Team Member to an unassigned task', async () => {
    const fetch = api('TeamMember', MEMBER_PERMS, {
      'GET /api/v1/tasks/t2': [200, detail({ ...MEMBER_TASK_PERMS, edit_work: false }, { id: 't2', title: 'Checkout flow', assignees: [] })],
      'PATCH /api/v1/tasks/t2': [200, task({ id: 't2', title: 'Checkout flow', version: 2 })],
    });
    renderRoutes(routes, '/projects/p-a?tab=tasks&task=t2');
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Assign me' }));
    await waitFor(() => expect(sent(fetch, 'PATCH /api/v1/tasks/t2')).toEqual([{ version: 1, assignee_ids: ['id-TeamMember'] }]));
  });

  it('a PM can delete a task and is told how many subtasks go with it', async () => {
    const fetch = api('PM', PM_PERMS, {
      'GET /api/v1/tasks/t1': [
        200,
        detail({ ...MEMBER_TASK_PERMS, edit_details: true, change_visibility: true, change_milestone: true, change_billable: true, assign_others: true, reopen: true, delete: true, move: true, manage_dependencies: true }, { subtask_count: 2 }),
      ],
      'DELETE /api/v1/tasks/t1': [200, { deleted_subtasks: 2 }],
    });
    renderRoutes(routes, '/projects/p-a?tab=tasks&task=t1');
    const panel = await screen.findByRole('dialog');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Delete task' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete "Wireframes"?' });
    expect(within(confirm).getByText('This also deletes 2 subtasks.')).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(sent(fetch, 'DELETE /api/v1/tasks/t1')).toHaveLength(1));
  });
});

describe('My Tasks (FR-TSK-10)', () => {
  const group = (data) => ({ total: data.length, data });
  it('groups my open tasks by due date and links to each task', async () => {
    api('TeamMember', MEMBER_PERMS, {
      'GET /api/v1/me/tasks': [
        200,
        {
          as_of: TODAY,
          week_end: TODAY,
          overdue: group([{ ...task(), project: { id: 'p-a', code: 'NOV-001', name: 'E-Commerce Platform' } }]),
          today: group([]),
          this_week: group([]),
          later: group([]),
        },
      ],
    });
    renderRoutes(routes, '/my-tasks');
    const overdue = await screen.findByRole('region', { name: /Overdue/ });
    expect(within(overdue).getByRole('link', { name: 'Wireframes' })).toHaveAttribute('href', '/projects/p-a?tab=tasks&task=t1');
    expect(within(screen.getByRole('region', { name: /This week/ })).getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My tasks' })).toBeInTheDocument();
  });
});

describe('Templates (FR-PRJ-02/03/12, D-26)', () => {
  const TEMPLATE = { id: 'tpl1', name: 'Web build', description: null, billing_type: 'Fixed', counts: { milestones: 2, tasks: 8, members: 3 }, created_at: '2026-10-10T10:00:00.000Z', version: 1 };

  it('lists templates for a PM', async () => {
    api('PM', PM_PERMS, { 'GET /api/v1/templates': [200, { data: [TEMPLATE] }] });
    renderRoutes(routes, '/templates');
    expect(await screen.findByText('Web build')).toBeInTheDocument();
    expect(screen.getByText(/2 milestones · 8 tasks · 3 members/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('a Team Member has no Templates page or link', async () => {
    api('TeamMember', MEMBER_PERMS);
    renderRoutes(routes, '/templates');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Templates' })).not.toBeInTheDocument();
  });

  it('saves a project as a template', async () => {
    const fetch = api('PM', PM_PERMS, { 'POST /api/v1/templates': [201, { ...TEMPLATE, name: 'E-Commerce Platform' }] });
    renderRoutes(routes, '/projects/p-a');
    fireEvent.click(await screen.findByRole('button', { name: 'Save as template' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as template' }));
    await waitFor(() => expect(sent(fetch, 'POST /api/v1/templates')).toEqual([{ project_id: 'p-a', name: 'E-Commerce Platform', description: null }]));
    expect(await screen.findByText('Template "E-Commerce Platform" saved.')).toBeInTheDocument();
  });

  it('duplicates a project and opens the copy', async () => {
    const fetch = api('PM', PM_PERMS, {
      'POST /api/v1/projects/p-a/duplicate': [201, { ...project(PM_PERMS), id: 'p-copy', name: 'E-Commerce Platform (copy)' }],
      'GET /api/v1/projects/p-copy': [200, { ...project(PM_PERMS), id: 'p-copy', code: 'NOV-002', name: 'E-Commerce Platform (copy)' }],
    });
    const router = renderRoutes(routes, '/projects/p-a');
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-copy'));
    expect(sent(fetch, 'POST /api/v1/projects/p-a/duplicate')).toEqual([{ name: 'E-Commerce Platform (copy)', start_date: '2026-10-01' }]);
  });

  it('offers templates when creating a project', async () => {
    const fetch = api('PM', PM_PERMS, {
      'GET /api/v1/templates': [200, { data: [TEMPLATE] }],
      'GET /api/v1/clients': [200, { data: [{ id: 'c-nova', name: 'Nova Retail', currency: 'JOD', status: 'Active' }], page: 1, page_size: 100, total: 1 }],
      'GET /api/v1/users': [200, { data: [{ id: 'id-PM', full_name: 'Lina', role: 'PM', status: 'Active' }], page: 1, page_size: 100, total: 1 }],
    });
    renderRoutes(routes, '/projects');
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const select = await screen.findByLabelText('Start from template');
    await within(select).findByRole('option', { name: 'Web build' });
    expect(fetch).toHaveBeenCalled();
  });
});
