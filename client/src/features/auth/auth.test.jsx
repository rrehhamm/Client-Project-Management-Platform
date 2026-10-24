import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { meFor, mockApi, renderRoutes } from '@/test/utils';

const signedOut = { 'GET /api/v1/auth/me': [401, { code: 'UNAUTHENTICATED', message: 'Please sign in', fields: [] }], 'POST /api/v1/auth/refresh': [401, {}] };

describe('LoginPage', () => {
  it('FR-AUTH-03: shows inline errors and sends no request when fields are empty or invalid', async () => {
    const fetchMock = mockApi(signedOut);
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(routes, '/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/login'))).toBe(false);
  });

  it('FR-AUTH-02: shows the server\'s generic message on wrong credentials', async () => {
    document.cookie = 'cpm_csrf=t.s; path=/';
    vi.stubGlobal(
      'fetch',
      mockApi({ ...signedOut, 'POST /api/v1/auth/login': [401, { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect', fields: [] }] }),
    );
    renderRoutes(routes, '/login');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'lina@nexa.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('FR-AUTH-04: after login the user returns to ?next=', async () => {
    document.cookie = 'cpm_csrf=t.s; path=/';
    let signedIn = false;
    vi.stubGlobal(
      'fetch',
      mockApi({
        'GET /api/v1/auth/me': () => (signedIn ? [200, meFor('Admin')] : signedOut['GET /api/v1/auth/me']),
        'POST /api/v1/auth/refresh': [401, {}],
        'POST /api/v1/auth/login': () => {
          signedIn = true;
          return [200, { principal: meFor('Admin').principal, home: '/' }];
        },
        'GET /api/v1/users': [200, { data: [], page: 1, page_size: 25, total: 0 }],
      }),
    );
    const router = renderRoutes(routes, '/login?next=%2Fteam');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'admin@nexa.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Nexa-dev-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/team'));
  });
});

describe('route guards', () => {
  it('FR-AUTH-04 / TC-AUTH-003: a signed-out visitor of /team is sent to /login?next=/team', async () => {
    vi.stubGlobal('fetch', mockApi(signedOut));
    const router = renderRoutes(routes, '/team');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fteam');
  });

  it('a Client Contact who opens an internal page lands in the portal', async () => {
    vi.stubGlobal('fetch', mockApi({ 'GET /api/v1/auth/me': [200, meFor('Contact')] }));
    const router = renderRoutes(routes, '/team');
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal'));
    expect(await screen.findByText(/Nova Retail projects/)).toBeInTheDocument();
  });

  it('an internal user who opens the portal lands on the dashboard', async () => {
    vi.stubGlobal('fetch', mockApi({ 'GET /api/v1/auth/me': [200, meFor('TeamMember')] }));
    const router = renderRoutes(routes, '/portal');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('a Team Member sees no Team link, and /team shows "no access"', async () => {
    vi.stubGlobal('fetch', mockApi({ 'GET /api/v1/auth/me': [200, meFor('TeamMember')] }));
    renderRoutes(routes, '/team');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('a signed-in user who opens /login goes home', async () => {
    vi.stubGlobal('fetch', mockApi({ 'GET /api/v1/auth/me': [200, meFor('PM')] }));
    const router = renderRoutes(routes, '/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
