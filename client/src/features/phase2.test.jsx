// UI checks for Phase 2 screens: what each role is shown (the API enforces the same rules).
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const WS_PUBLIC = { id: 'w1', name: 'Nexa', logo_url: null, brand_color: '#2563EB', timezone: 'Asia/Amman', currency: 'JOD', date_format: 'DD/MM/YYYY', week_start_day: 0 };

const NOVA = {
  id: 'c-nova',
  name: 'Nova Retail',
  status: 'Active',
  code_prefix: 'NOV',
  code_prefix_locked: true,
  currency: 'JOD',
  primary_contact: { id: 'ct1', full_name: 'Maya', email: 'maya@novaretail.test' },
  active_projects: 1,
  outstanding_balance: 1750,
  version: 1,
};

const PROJECT = {
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
  close_task_on_approval: false,
  is_overdue: false,
  archived_at: null,
  deleted_at: null,
  version: 3,
  task_summary: { ToDo: 0, InProgress: 0, InReview: 0, Done: 0, Blocked: 0, Cancelled: 0 },
  milestone_summary: { Upcoming: 0, InProgress: 0, Completed: 0 },
  member_count: 2,
  allowed_transitions: ['OnHold', 'Completed', 'Cancelled'],
};

const withFinancials = { ...PROJECT, budget_amount: 12_000_000, budget_minutes: null, currency: 'JOD' };
const empty = { data: [], page: 1, page_size: 25, total: 0 };

function api(role, extra = {}) {
  vi.stubGlobal(
    'fetch',
    mockApi({
      'GET /api/v1/auth/me': [200, meFor(role)],
      'GET /api/v1/workspace': [200, WS_PUBLIC],
      ...extra,
    }),
  );
}

describe('Clients', () => {
  it('lists clients with primary contact, active projects and outstanding balance (FR-CLI-03)', async () => {
    api('PM', { 'GET /api/v1/clients': [200, { data: [NOVA], page: 1, page_size: 25, total: 1 }] });
    renderRoutes(routes, '/clients');
    const row = await screen.findByTestId('client-row-Nova Retail');
    expect(within(row).getByText('Maya')).toBeInTheDocument();
    expect(within(row).getByText('1.750 JOD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New client' })).toBeInTheDocument();
  });

  it('Finance can browse clients but not create them', async () => {
    api('Finance', { 'GET /api/v1/clients': [200, { data: [NOVA], page: 1, page_size: 25, total: 1 }] });
    renderRoutes(routes, '/clients');
    await screen.findByTestId('client-row-Nova Retail');
    expect(screen.queryByRole('button', { name: 'New client' })).not.toBeInTheDocument();
  });

  it('a Team Member has no Clients page or link', async () => {
    api('TeamMember');
    renderRoutes(routes, '/clients');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Clients' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('shows an empty state with a create action when there are no clients', async () => {
    api('Admin', { 'GET /api/v1/clients': [200, empty] });
    renderRoutes(routes, '/clients');
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument();
  });
});

describe('Project detail', () => {
  it('a PM sees the status actions allowed by BRD 16.1 and the budget', async () => {
    api('PM', {
      'GET /api/v1/projects/p-a': [200, { ...withFinancials, permissions: { update: true, delete: false, manage_members: true, manage_milestones: true } }],
      'GET /api/v1/projects/p-a/milestones': [200, { data: [] }],
      'GET /api/v1/projects/p-a/activity': [200, empty],
    });
    renderRoutes(routes, '/projects/p-a');
    expect(await screen.findByRole('heading', { name: 'E-Commerce Platform' })).toBeInTheDocument();
    for (const name of ['Put on hold', 'Mark completed', 'Cancel project']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument();
    expect(screen.getByText('12000.000 JOD')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('a Team Member sees no actions, no budget and no Settings tab', async () => {
    api('TeamMember', {
      'GET /api/v1/projects/p-a': [200, { ...PROJECT, permissions: { update: false, delete: false, manage_members: false, manage_milestones: false } }],
      'GET /api/v1/projects/p-a/milestones': [200, { data: [] }],
      'GET /api/v1/projects/p-a/activity': [200, empty],
    });
    renderRoutes(routes, '/projects/p-a');
    await screen.findByRole('heading', { name: 'E-Commerce Platform' });
    expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('an archived project says it is read-only and offers Unarchive only', async () => {
    api('Admin', {
      'GET /api/v1/projects/p-a': [
        200,
        { ...withFinancials, status: 'Completed', archived_at: '2026-10-20T10:00:00Z', allowed_transitions: ['InProgress'], permissions: { update: true, delete: true, manage_members: true, manage_milestones: true } },
      ],
      'GET /api/v1/projects/p-a/milestones': [200, { data: [] }],
      'GET /api/v1/projects/p-a/activity': [200, empty],
    });
    renderRoutes(routes, '/projects/p-a');
    expect(await screen.findByText('This project is archived and read-only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('deleting needs the exact project name typed (FR-PRJ-11)', async () => {
    api('Admin', {
      'GET /api/v1/projects/p-a': [200, { ...withFinancials, permissions: { update: true, delete: true, manage_members: true, manage_milestones: true } }],
      'GET /api/v1/projects/p-a/milestones': [200, { data: [] }],
      'GET /api/v1/projects/p-a/activity': [200, empty],
    });
    renderRoutes(routes, '/projects/p-a');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete project' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete project' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type the project name to confirm'), { target: { value: 'E-Commerce Platform' } });
    expect(confirm).toBeEnabled();
  });
});

describe('Projects list', () => {
  it('shows rows and switches to cards; the trash filter is for Owner/Admin only', async () => {
    api('PM', {
      'GET /api/v1/projects': [200, { data: [withFinancials], page: 1, page_size: 25, total: 1 }],
      'GET /api/v1/clients': [200, { data: [NOVA], page: 1, page_size: 100, total: 1 }],
    });
    renderRoutes(routes, '/projects');
    expect(await screen.findByTestId('project-row-NOV-001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Deleted (30 days)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(await screen.findByTestId('project-card-NOV-001')).toBeInTheDocument();
  });
});

describe('Workspace settings', () => {
  it('Owner/Admin only; the currency is disabled once locked (D-21)', async () => {
    api('Admin', { 'GET /api/v1/workspace': [200, { ...WS_PUBLIC, currency_locked: true, version: 2, invoice_prefix: 'INV-', next_invoice_number: 1, proposal_prefix: 'PRO-', next_proposal_number: 1 }] });
    renderRoutes(routes, '/settings');
    expect(await screen.findByRole('heading', { name: 'Workspace settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default currency')).toBeDisabled();
    expect(screen.getByText('Locked because user rates or time entries already use it.')).toBeInTheDocument();
  });

  it('a PM has no Settings page or link', async () => {
    api('PM');
    renderRoutes(routes, '/settings');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
