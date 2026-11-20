// D-45 UI checks: sidebar navigation, mobile drawer, appearance setting, brand colour.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const WS_PUBLIC = { id: 'w1', name: 'Nexa', logo_url: null, brand_color: '#3E5BA3', timezone: 'Asia/Amman', currency: 'JOD', date_format: 'DD/MM/YYYY', week_start_day: 0 };

function api(me, extra = {}) {
  const fetch = mockApi({
    'GET /api/v1/auth/me': [200, me],
    'GET /api/v1/workspace': [200, WS_PUBLIC],
    'GET /api/v1/me/notifications/unread-count': [200, { unread: 0 }],
    'GET /api/v1/dashboard': [200, { view: 'workspace', week: { start: '2026-11-15', end: '2026-11-21', today: '2026-11-21' }, cards: [], projects: [] }],
    ...extra,
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  document.documentElement.className = '';
  document.getElementById('brand-tokens')?.remove();
  localStorage.clear();
});

describe('sidebar (D-45)', () => {
  it('lists only the sections the role can use, grouped, with the current page marked', async () => {
    api(meFor('PM'));
    renderRoutes(routes, '/');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['My tasks', 'Clients', 'Projects', 'Templates', 'Team']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Signed in as PM Person' })).toHaveAttribute('href', '/account');
  });

  it('collapses to icons, keeps accessible names and remembers the choice', async () => {
    api(meFor('Owner'));
    renderRoutes(routes, '/');
    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' });
    fireEvent.click(collapse);
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute('title', 'Audit log');
    expect(localStorage.getItem('cpm.sidebar')).toBe('collapsed');
  });

  it('opens the same navigation in a drawer from the menu button', async () => {
    api(meFor('TeamMember'));
    renderRoutes(routes, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog');
    const nav = within(drawer).getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'My tasks' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Clients' })).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('appearance setting (D-45)', () => {
  it('applies the user’s saved appearance after sign-in', async () => {
    api(meFor('PM', { principal: { ...meFor('PM').principal, appearance: 'dark' } }));
    renderRoutes(routes, '/');
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  });

  it('switches at once and saves the choice for the user', async () => {
    const fetch = api(meFor('PM', { principal: { ...meFor('PM').principal, appearance: 'light' } }), {
      'PUT /api/v1/auth/me/appearance': (init) => [200, JSON.parse(init.body)],
    });
    renderRoutes(routes, '/account');
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: /Dark/ }));
    expect(document.documentElement).toHaveClass('dark');
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true'));
    const put = fetch.mock.calls.find(([url, init = {}]) => init.method === 'PUT' && String(url).endsWith('/auth/me/appearance'));
    expect(JSON.parse(put[1].body)).toEqual({ appearance: 'dark' });
  });
});

describe('brand colour (D-45)', () => {
  it('applies the workspace colour app-wide, darkened until it meets AA', async () => {
    const me = meFor('PM');
    api({ ...me, workspace: { ...me.workspace, brand_color: '#FACC15' } });
    renderRoutes(routes, '/');
    await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(document.getElementById('brand-tokens')).not.toBeNull());
    const css = document.getElementById('brand-tokens').textContent;
    expect(css).toMatch(/^:root\{--primary:#[0-9A-F]{6};/);
    expect(css).not.toContain('--primary:#FACC15;--primary-foreground:#FFFFFF'); // never white on yellow
  });
});
