import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Render with a fresh query client that never retries. */
export function renderWithQuery(ui) {
  return render(<QueryClientProvider client={newClient()}>{ui}</QueryClientProvider>);
}

/** Render a route table at `path`. Returns the router so tests can read the location. */
export function renderRoutes(routes, path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={newClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** A fetch() Response for stubbing. */
export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** fetch mock answering by "METHOD /api/v1/path" (query string ignored) with fresh responses. */
export function mockApi(routes) {
  return vi.fn(async (url, init = {}) => {
    const path = String(url).split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) return jsonResponse(404, { code: 'NOT_FOUND', message: `No mock for ${key}`, fields: [] });
    const [status, body] = typeof handler === 'function' ? handler(init, url) : handler;
    return jsonResponse(status, body);
  });
}

/** /auth/me payload for a role (capabilities mirror the server's). */
export function meFor(role, overrides = {}) {
  const isContact = role === 'Contact';
  const work = { view_clients: true, create_clients: true, edit_clients: true, manage_contacts: true, list_projects: true, create_projects: true, view_financials: true, my_tasks: true, list_templates: true, manage_templates: true, search: true };
  const caps = {
    Owner: { manage_team: true, invite_users: true, invite_any_role: true, change_roles: true, deactivate_users: true, view_rates: true, edit_rates: true, transfer_ownership: true, manage_workspace: true, view_audit: true, delete_clients: true, delete_projects: true, ...work },
    Admin: { manage_team: true, invite_users: true, invite_any_role: true, change_roles: true, deactivate_users: true, view_rates: true, edit_rates: true, manage_workspace: true, view_audit: true, delete_clients: true, delete_projects: true, ...work },
    PM: { manage_team: true, invite_users: true, ...work },
    Finance: { manage_team: true, view_rates: true, edit_rates: true, view_clients: true, list_projects: true, view_financials: true, my_tasks: true, search: true },
    TeamMember: { list_projects: true, my_tasks: true, search: true },
    Contact: { list_projects: true },
  }[role];
  return {
    principal: {
      kind: isContact ? 'contact' : 'user',
      id: `id-${role}`,
      email: `${role.toLowerCase()}@nexa.test`,
      full_name: `${role} Person`,
      role: isContact ? null : role,
      phone: null,
      timezone: null,
      version: 1,
      client: isContact ? { id: 'c1', name: 'Nova Retail' } : null,
    },
    workspace: { id: 'w1', name: 'Nexa', timezone: 'Asia/Amman', currency: 'JOD', date_format: 'DD/MM/YYYY', week_start_day: 0 },
    capabilities: { internal_app: !isContact, portal: isContact, invite_users: false, invite_any_role: false, change_roles: false, deactivate_users: false, view_rates: false, edit_rates: false, transfer_ownership: false, manage_team: false, ...caps },
    home: isContact ? '/portal' : '/',
    ...overrides,
  };
}
