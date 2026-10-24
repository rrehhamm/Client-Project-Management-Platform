import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const USERS = [
  { id: 'id-Owner', email: 'owner@nexa.test', full_name: 'Nexa Owner', role: 'Owner', status: 'Active', capacity_minutes_per_week: 2400, last_login_at: null, version: 1, hourly_cost_rate: null, default_bill_rate: null },
  { id: 'u-omar', email: 'omar@nexa.test', full_name: 'Omar', role: 'TeamMember', status: 'Active', capacity_minutes_per_week: 2400, last_login_at: '2026-10-24T08:00:00Z', version: 1, hourly_cost_rate: 15000, default_bill_rate: 40000 },
  { id: 'u-new', email: 'new@nexa.test', full_name: 'New Person', role: 'TeamMember', status: 'Invited', capacity_minutes_per_week: 2400, last_login_at: null, version: 1 },
];

function setup(role, users = USERS) {
  vi.stubGlobal(
    'fetch',
    mockApi({
      'GET /api/v1/auth/me': [200, meFor(role)],
      'GET /api/v1/users': [200, { data: users, page: 1, page_size: 25, total: users.length }],
    }),
  );
  renderRoutes(routes, '/team');
}

describe('TeamPage', () => {
  it('Owner sees rates, invite button and row actions (incl. Make owner only for active Admins)', async () => {
    setup('Owner');
    const omar = await screen.findByTestId('user-row-omar@nexa.test');
    expect(screen.getByRole('button', { name: 'Invite person' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cost / bill rate' })).toBeInTheDocument();
    expect(within(omar).getByText('15.000 JOD / 40.000 JOD')).toBeInTheDocument();
    expect(within(omar).getByRole('button', { name: 'Deactivate: Omar' })).toBeInTheDocument();
    expect(within(omar).queryByRole('button', { name: /Make owner/ })).not.toBeInTheDocument();
    const invited = screen.getByTestId('user-row-new@nexa.test');
    expect(within(invited).getByRole('button', { name: 'Resend invite: New Person' })).toBeInTheDocument();
  });

  it('nobody is offered "Deactivate" on the Owner or on themselves', async () => {
    setup('Owner');
    const ownerRow = await screen.findByTestId('user-row-owner@nexa.test');
    expect(within(ownerRow).queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
  });

  it('PM sees no rates column and no role or deactivate actions (FR-USER-07)', async () => {
    setup('PM', USERS.map(({ hourly_cost_rate: _a, default_bill_rate: _b, ...u }) => u));
    const omar = await screen.findByTestId('user-row-omar@nexa.test');
    expect(screen.queryByRole('columnheader', { name: 'Cost / bill rate' })).not.toBeInTheDocument();
    expect(within(omar).queryByRole('button', { name: /Deactivate|Edit/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite person' })).toBeInTheDocument();
  });

  it('Finance can edit rates but cannot invite', async () => {
    setup('Finance');
    const omar = await screen.findByTestId('user-row-omar@nexa.test');
    expect(screen.queryByRole('button', { name: 'Invite person' })).not.toBeInTheDocument();
    expect(within(omar).getByRole('button', { name: 'Edit: Omar' })).toBeInTheDocument();
  });

  it('shows an empty state when no one matches', async () => {
    setup('Admin', []);
    expect(await screen.findByText('No people match these filters.')).toBeInTheDocument();
  });

  it('shows an error state with Retry when the list fails (FR-DASH-06)', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        'GET /api/v1/auth/me': [200, meFor('Admin')],
        'GET /api/v1/users': [500, { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', fields: [] }],
      }),
    );
    renderRoutes(routes, '/team');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
