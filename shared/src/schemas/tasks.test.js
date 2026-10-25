import { describe, expect, it } from 'vitest';
import { allowedTaskTargets, taskCreateSchema, taskTransition } from './tasks.js';

describe('taskTransition (D-23)', () => {
  it('open statuses move in any direction', () => {
    for (const [from, to] of [['ToDo', 'InReview'], ['InReview', 'ToDo'], ['Blocked', 'InProgress'], ['InProgress', 'Blocked']]) {
      expect(taskTransition(from, to), `${from}→${to}`).toBe('move');
    }
  });
  it('Done from any open status except Blocked; Cancelled from any open status', () => {
    expect(taskTransition('ToDo', 'Done')).toBe('move');
    expect(taskTransition('Blocked', 'Done')).toBeNull();
    expect(taskTransition('Blocked', 'Cancelled')).toBe('move');
  });
  it('closed tasks only reopen to To Do', () => {
    expect(taskTransition('Done', 'ToDo')).toBe('reopen');
    expect(taskTransition('Cancelled', 'ToDo')).toBe('reopen');
    expect(taskTransition('Done', 'InProgress')).toBeNull();
    expect(taskTransition('Done', 'Cancelled')).toBeNull();
    expect(allowedTaskTargets('Done')).toEqual(['ToDo']);
  });
  it('same status is not a change', () => {
    expect(taskTransition('ToDo', 'ToDo')).toBeNull();
  });
});

describe('taskCreateSchema', () => {
  it('dedupes labels and assignees, caps labels at 10', () => {
    const v = taskCreateSchema.parse({ title: 'x', labels: ['a', 'a', 'b'], assignee_ids: ['0192f0c0-0000-7000-8000-000000000001', '0192f0c0-0000-7000-8000-000000000001'] });
    expect(v.labels).toEqual(['a', 'b']);
    expect(v.assignee_ids).toHaveLength(1);
    expect(taskCreateSchema.safeParse({ title: 'x', labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }).success).toBe(false);
  });
});
