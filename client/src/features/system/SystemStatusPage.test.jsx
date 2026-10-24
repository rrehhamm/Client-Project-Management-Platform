import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithQuery } from '@/test/utils';
import { SystemStatusPage } from './SystemStatusPage';

const ALL_OK = { status: 'ok', checks: { database: 'ok', storage: 'ok', mail: 'ok' } };

describe('SystemStatusPage (FR-DASH-06 states)', () => {
  it('shows a loading state first', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWithQuery(<SystemStatusPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('shows every service as OK when the API is ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, ALL_OK)));
    renderWithQuery(<SystemStatusPage />);
    expect(await screen.findByText('All services are running')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(3);
  });

  it('shows which service is down on a 503 instead of a generic error', async () => {
    const body = {
      code: 'SERVICE_UNAVAILABLE',
      message: 'One or more services are unavailable',
      fields: [],
      checks: { database: 'ok', storage: 'error', mail: 'ok' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, body)));
    renderWithQuery(<SystemStatusPage />);
    expect(await screen.findByText('Some services are unavailable')).toBeInTheDocument();
    expect(screen.getByText('File storage').nextSibling).toHaveTextContent('Unavailable');
  });

  it('shows an error with Retry when the API cannot be reached, and recovers on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, ALL_OK));
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<SystemStatusPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(screen.queryByText('OK')).not.toBeInTheDocument(); // no fake numbers on error
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('All services are running')).toBeInTheDocument();
  });
});
