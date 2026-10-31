// UI checks for Phase 4: dashboard, bell, comments, files, search, audit log.
// The API enforces the rules; these tests check what each role sees and what is sent.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { safeHtml } from '@/lib/safeHtml';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const WS_PUBLIC = { id: 'w1', name: 'Nexa', logo_url: null, brand_color: '#2563EB', timezone: 'Asia/Amman', currency: 'JOD', date_format: 'DD/MM/YYYY', week_start_day: 0 };
const WEEK = { start: '2026-10-25', end: '2026-10-31', today: '2026-10-28' };

const PERMS = { update: true, delete: false, manage_members: true, manage_milestones: true, create_task: true, manage_tasks: true, assign_self: true, save_template: true, duplicate: true, upload_file: true, manage_files: true, comment: true };
const MEMBER_PERMS = { ...PERMS, update: false, manage_members: false, manage_milestones: false, manage_tasks: false, save_template: false, duplicate: false, manage_files: false };
const project = (permissions = PERMS) => ({
  id: 'p-a',
  code: 'NOV-001',
  name: 'E-Commerce Platform',
  client: { id: 'c-nova', name: 'Nova Retail' },
  status: 'InProgress',
  start_date: '2026-10-01',
  due_date: '2027-01-31',
  progress_pct: 40,
  pm: { id: 'id-PM', full_name: 'Lina', status: 'Active' },
  portal_enabled: true,
  is_overdue: false,
  archived_at: null,
  version: 3,
  task_summary: { ToDo: 0, InProgress: 0, InReview: 0, Done: 0, Blocked: 0, Cancelled: 0 },
  milestone_summary: { Upcoming: 0, InProgress: 0, Completed: 0 },
  member_count: 2,
  allowed_transitions: [],
  permissions,
});

function api(role, extra = {}) {
  const fetch = mockApi({
    'GET /api/v1/auth/me': [200, meFor(role)],
    'GET /api/v1/workspace': [200, WS_PUBLIC],
    'GET /api/v1/me/notifications/unread-count': [200, { unread: 0 }],
    ...extra,
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const calls = (fetch, key) => fetch.mock.calls.filter(([url, init = {}]) => `${init.method ?? 'GET'} ${String(url).split('?')[0]}` === key).map(([url]) => String(url));

describe('dashboard (FR-DASH-01/03/05/06)', () => {
  it('Owner/Admin cards show counts and open the matching filtered list', async () => {
    api('Admin', {
      'GET /api/v1/dashboard': [
        200,
        {
          view: 'workspace',
          week: WEEK,
          cards: [
            { key: 'active_projects', count: 4, link: '/projects?status=InProgress' },
            { key: 'overdue_projects', count: 1, link: '/projects?overdue=true' },
            { key: 'tasks_due_this_week', count: 7, link: '/work?due=this_week' },
          ],
        },
      ],
    });
    renderRoutes(routes, '/');
    const overdue = await screen.findByRole('link', { name: 'Open the list: Overdue projects: 1' });
    expect(overdue).toHaveAttribute('href', '/projects?overdue=true');
    expect(screen.getByRole('link', { name: 'Open the list: Tasks due this week: 7' })).toHaveAttribute('href', '/work?due=this_week');
    expect(screen.getByText('Signed in as Admin · week of 25/10/2026 – 31/10/2026')).toBeInTheDocument();
  });

  it('TC-DASH-003: when the API fails, the dashboard shows an error with Retry and no numbers', async () => {
    api('Admin', { 'GET /api/v1/dashboard': [500, { code: 'INTERNAL_ERROR', message: 'Something went wrong', fields: [] }] });
    renderRoutes(routes, '/');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open the list/ })).not.toBeInTheDocument();
  });

  it('a Team Member sees their task groups and projects', async () => {
    api('TeamMember', {
      'GET /api/v1/dashboard': [200, { view: 'member', week: WEEK, cards: [], my_tasks: { overdue: 2, today: 1, this_week: 3, link: '/my-tasks' }, my_projects: { data: [project(MEMBER_PERMS)], total: 1, link: '/projects?member_id=id-TeamMember' } }],
    });
    renderRoutes(routes, '/');
    expect(await screen.findByRole('link', { name: 'Open the list: Overdue: 2' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByRole('link', { name: 'E-Commerce Platform' })).toHaveAttribute('href', '/projects/p-a');
  });

  it('the task drill-down list sends the card filter to the API and shows the same total', async () => {
    const fetch = api('PM', { 'GET /api/v1/tasks': [200, { data: [], page: 1, page_size: 50, total: 0, week: WEEK }] });
    renderRoutes(routes, '/work?status=InReview&mine=true');
    expect(await screen.findByText('No tasks match.')).toBeInTheDocument();
    const url = calls(fetch, 'GET /api/v1/tasks')[0];
    expect(url).toContain('status=InReview');
    expect(url).toContain('mine=true');
    expect(screen.getByText('Status: In review')).toBeInTheDocument();
  });

  it('project cards open the project list already filtered', async () => {
    const fetch = api('Admin', { 'GET /api/v1/projects': [200, { data: [], page: 1, page_size: 25, total: 0 }], 'GET /api/v1/clients': [200, { data: [], page: 1, page_size: 100, total: 0 }] });
    renderRoutes(routes, '/projects?overdue=true');
    await waitFor(() => expect(calls(fetch, 'GET /api/v1/projects').some((u) => u.includes('overdue=true'))).toBe(true));
    expect(await screen.findByRole('checkbox', { name: 'Overdue only' })).toBeChecked();
  });
});

describe('notification bell (FR-NOT-01)', () => {
  it('shows the unread count, lists notifications and marks one read when opened', async () => {
    const fetch = api('TeamMember', {
      'GET /api/v1/me/notifications/unread-count': [200, { unread: 2 }],
      'GET /api/v1/me/notifications': [
        200,
        { data: [{ id: 'n1', type: 'task_assigned', title: 'Lina assigned you "Wireframes"', link: '/my-tasks', read: false, created_at: '2026-10-28T08:00:00Z' }], page: 1, page_size: 20, total: 1, unread: 2 },
      ],
      'POST /api/v1/me/notifications/n1/read': [204, null],
      'GET /api/v1/me/tasks': [200, { as_of: WEEK.today, week_end: WEEK.end, overdue: { total: 0, data: [] }, today: { total: 0, data: [] }, this_week: { total: 0, data: [] }, later: { total: 0, data: [] } }],
      'GET /api/v1/dashboard': [200, { view: 'member', week: WEEK, cards: [], my_tasks: { overdue: 0, today: 0, this_week: 0, link: '/my-tasks' }, my_projects: { data: [], total: 0, link: '/projects' } }],
    });
    const router = renderRoutes(routes, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2 unread)' }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    fireEvent.click(await within(panel).findByRole('button', { name: /Lina assigned you "Wireframes"/ }));
    await waitFor(() => expect(calls(fetch, 'POST /api/v1/me/notifications/n1/read')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-tasks'));
  });
});

describe('comments (FR-COM-02/04, TC-COM-002)', () => {
  const comment = (over) => ({
    id: 'c1',
    entity_type: 'Task',
    entity_id: 't1',
    parent_id: null,
    body: '<p>Looks good</p>',
    deleted: false,
    visibility: 'Internal',
    author: { kind: 'user', id: 'id-PM', full_name: 'Lina' },
    mentions: [],
    attachments: [],
    edited: false,
    reply_count: 0,
    created_at: '2026-10-28T09:00:00Z',
    version: 1,
    permissions: { edit: true, delete: true },
    ...over,
  });
  const TASK = { id: 't1', project_id: 'p-a', parent_task_id: null, milestone: null, title: 'Homepage', description: null, status: 'ToDo', priority: 'Normal', start_date: null, due_date: null, estimate_minutes: null, visibility: 'Internal', is_billable: null, labels: [], assignees: [], has_inactive_assignee: false, is_overdue: false, subtask_count: 0, created_by: 'id-PM', created_at: '2026-10-02T08:00:00.000Z', version: 1, subtasks: [], checklist: [], predecessors: [], successors: [], permissions: { edit_work: true, edit_details: true, change_visibility: true, change_milestone: true, change_billable: true, assign_others: true, assign_self: true, reopen: true, delete: true, move: true, manage_dependencies: true } };

  function taskApi(comments) {
    return api('PM', {
      'GET /api/v1/projects/p-a': [200, project()],
      'GET /api/v1/projects/p-a/tasks': [200, { data: [TASK], page: 1, page_size: 100, total: 1 }],
      'GET /api/v1/projects/p-a/milestones': [200, { data: [] }],
      'GET /api/v1/projects/p-a/members': [200, { data: [] }],
      'GET /api/v1/projects/p-a/labels': [200, { data: [] }],
      'GET /api/v1/projects': [200, { data: [], page: 1, page_size: 100, total: 0 }],
      'GET /api/v1/tasks/t1': [200, TASK],
      'GET /api/v1/comments': [200, { data: comments, page: 1, page_size: 100, total: comments.length }],
      'GET /api/v1/comments/mentionable': [200, { data: [] }],
      'GET /api/v1/follows': [200, { following: true }],
    });
  }

  it('shows Internal comments with the yellow tag, "edited", and deleted ones as a placeholder', async () => {
    taskApi([comment(), comment({ id: 'c2', edited: true, visibility: 'Client', body: '<p>Shared</p>' }), comment({ id: 'c3', deleted: true, body: null, permissions: { edit: false, delete: false } })]);
    renderRoutes(routes, '/projects/p-a?tab=tasks&task=t1');
    const c1 = await screen.findByTestId('comment-c1');
    expect(within(c1).getByText('Internal')).toBeInTheDocument();
    expect(within(screen.getByTestId('comment-c2')).getByText('(edited)')).toBeInTheDocument();
    expect(within(screen.getByTestId('comment-c2')).queryByText('Internal')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('comment-c3')).getByText('Comment deleted')).toBeInTheDocument();
    expect(within(screen.getByTestId('comment-c3')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-COM-002: a script in a comment body is never put into the page', async () => {
    taskApi([comment({ body: '<p>Hi</p><script>window.__xss = 1</script><img src=x onerror="window.__xss=1"><a href="javascript:alert(1)">link</a>' })]);
    renderRoutes(routes, '/projects/p-a?tab=tasks&task=t1');
    const c1 = await screen.findByTestId('comment-c1');
    expect(c1.querySelector('script, img')).toBeNull();
    expect(within(c1).getByText('link')).not.toHaveAttribute('href');
    expect(window.__xss).toBeUndefined();
  });
});

describe('safeHtml (NFR-SEC-02)', () => {
  it('keeps formatting and safe links, drops everything else', () => {
    expect(safeHtml('<p><strong>a</strong> <a href="https://x.test" onclick="x()">b</a></p>')).toBe('<p><strong>a</strong> <a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">b</a></p>');
    expect(safeHtml('<script>alert(1)</script><style>p{}</style><iframe src="x"></iframe>')).toBe('');
    expect(safeHtml('<div onmouseover="x">text</div>')).toBe('text');
    expect(safeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer nofollow">x</a>');
  });
});

describe('files (FR-FILE-01/05/07)', () => {
  const FILE = (over) => ({ id: 'f1', project_id: 'p-a', name: 'brief.pdf', visibility: 'Internal', folder: null, task: null, latest: { version_no: 1, mime_type: 'application/pdf', size_bytes: 2_500_000, scan_status: 'Clean', previewable: true, uploaded_by: { id: 'id-PM', full_name: 'Lina' }, created_at: '2026-10-28T09:00:00Z' }, version_count: 1, version: 1, ...over });
  const filesApi = (role, perms) =>
    api(role, {
      'GET /api/v1/projects/p-a': [200, project(perms)],
      'GET /api/v1/projects/p-a/files': [200, { data: [FILE(), FILE({ id: 'f2', name: 'logo.png', visibility: 'Client', latest: { ...FILE().latest, version_no: 2, scan_status: 'Pending', size_bytes: 1024 }, version_count: 2 })], page: 1, page_size: 100, total: 2 }],
      'GET /api/v1/projects/p-a/folders': [200, { data: [{ id: 'd1', name: 'Designs', file_count: 0, version: 1 }] }],
    });

  it('lists files with size, uploader, Internal tag, version and scan state; PMs can add folders', async () => {
    filesApi('PM', PERMS);
    renderRoutes(routes, '/projects/p-a?tab=files');
    const brief = await screen.findByTestId('file-row-brief.pdf');
    expect(within(brief).getByText('2.4 MB')).toBeInTheDocument();
    expect(within(brief).getByText('Lina')).toBeInTheDocument();
    expect(within(brief).getByText('Internal')).toBeInTheDocument();
    const logo = screen.getByTestId('file-row-logo.png');
    expect(within(logo).getByText('Version 2')).toBeInTheDocument();
    expect(within(logo).getByText('Scanning for viruses…')).toBeInTheDocument();
    expect(within(logo).getByText('Visible to client')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Designs/ })).toBeInTheDocument();
  });

  it('a Team Member can upload but not create folders', async () => {
    filesApi('TeamMember', MEMBER_PERMS);
    renderRoutes(routes, '/projects/p-a?tab=files');
    await screen.findByTestId('file-row-brief.pdf');
    expect(screen.getByText('Upload files')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).not.toBeInTheDocument();
  });

  it('a file over 100 MB is refused before it is sent', async () => {
    const fetch = filesApi('PM', PERMS);
    renderRoutes(routes, '/projects/p-a?tab=files');
    await screen.findByTestId('file-row-brief.pdf');
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [big] } });
    expect(await screen.findByText('"huge.mp4" was not uploaded: it is larger than 100 MB')).toBeInTheDocument();
    expect(calls(fetch, 'POST /api/v1/projects/p-a/files')).toHaveLength(0);
  });
});

describe('search (FR-SRCH-01)', () => {
  it('asks for 2 characters, then lists results grouped by type', async () => {
    api('PM', {
      'GET /api/v1/dashboard': [200, { view: 'pm', week: WEEK, cards: [], my_projects: { data: [], total: 0, link: '/projects' } }],
      'GET /api/v1/search': [200, { q: 'co', total: 2, groups: { projects: [{ id: 'p-b', title: 'Corporate Website', subtitle: 'BRI-001', link: '/projects/p-b' }], tasks: [], files: [{ id: 'f1', title: 'Contract.pdf', subtitle: 'NOV-001', link: '/projects/p-a?tab=files&file=f1' }], clients: [], contacts: [] } }],
    });
    renderRoutes(routes, '/');
    const box = await screen.findByRole('searchbox', { name: 'Search clients, projects, tasks, files and contacts' });
    fireEvent.change(box, { target: { value: 'c' } });
    expect(await screen.findByText('Type at least 2 characters.')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'co' } });
    const projects = await screen.findByRole('region', { name: 'Projects' });
    expect(within(projects).getByRole('button', { name: /Corporate Website/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Files' })).getByRole('button', { name: /Contract.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tasks' })).not.toBeInTheDocument();
  });
});

describe('audit log (FR-ACT-02)', () => {
  it('Admin sees the log with before/after values and a CSV export; the nav link is Admin-only', async () => {
    api('Admin', {
      'GET /api/v1/users': [200, { data: [], page: 1, page_size: 100, total: 0 }],
      'GET /api/v1/audit': [
        200,
        { data: [{ id: 'a1', created_at: '2026-10-28T09:00:00Z', actor: { type: 'User', id: 'id-PM', name: 'Lina' }, action: 'task.updated', entity_type: 'Task', entity_id: 't1-aaaa-bbbb', before: { priority: 'Normal' }, after: { priority: 'High' }, ip: '10.0.0.1' }], page: 1, page_size: 50, total: 1 },
      ],
    });
    renderRoutes(routes, '/audit');
    expect(await screen.findByText('task.updated')).toBeInTheDocument();
    expect(screen.getByText('{"priority":"Normal"}')).toBeInTheDocument();
    expect(screen.getByText('{"priority":"High"}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/v1/audit/export.csv');
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('a PM has no audit page or link', async () => {
    api('PM');
    renderRoutes(routes, '/audit');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });
});
