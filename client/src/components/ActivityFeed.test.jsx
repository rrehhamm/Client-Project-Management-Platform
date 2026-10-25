import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityFeed } from './ActivityFeed';

const query = (data) => ({ isPending: false, error: null, data: { data, page: 1, page_size: 25, total: data.length } });

describe('ActivityFeed (FR-ACT-01)', () => {
  it('describes dotted action names in words, with before → after', () => {
    render(
      <ActivityFeed
        page={1}
        onPage={() => {}}
        timeZone="Asia/Amman"
        query={query([
          { id: '1', action: 'project.status_changed', actor: { name: 'Lina' }, before: { status: 'NotStarted' }, after: { status: 'InProgress' }, created_at: '2026-10-25T09:00:00Z' },
          { id: '2', action: 'project.archived', actor: { name: 'Lina' }, before: null, after: null, created_at: '2026-10-25T10:00:00Z' },
          { id: '3', action: 'something.new', actor: { name: null }, before: null, after: null, created_at: '2026-10-25T11:00:00Z' },
        ])}
      />,
    );
    expect(screen.getByText('Lina changed the status')).toBeInTheDocument();
    expect(screen.getByText('status: Not started → In progress')).toBeInTheDocument();
    expect(screen.getByText('Lina archived the project')).toBeInTheDocument();
    expect(screen.getByText('System: something.new')).toBeInTheDocument(); // unknown action falls back
  });
});
