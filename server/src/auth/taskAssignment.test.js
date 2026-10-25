import { describe, expect, it } from 'vitest';
import { assignmentChangeProblem } from './taskAssignment.js';

const pm = { kind: 'user', id: 'pm', role: 'PM' };
const tm = { kind: 'user', id: 'tm', role: 'TeamMember' };
const ctx = (createdBy = 'pm') => ({ membership: { user_id: 'x' }, project: { client_id: 'c' }, record: { created_by: createdBy } });

describe('assignmentChangeProblem (D-24)', () => {
  it('PMs may change anything', () => {
    expect(assignmentChangeProblem(pm, ctx(), [{ user_id: 'a', created_by: 'pm' }], ['b', 'c'])).toBeNull();
  });
  it('a Team Member may add only themselves', () => {
    expect(assignmentChangeProblem(tm, ctx(), [], ['tm'])).toBeNull();
    expect(assignmentChangeProblem(tm, ctx(), [], ['tm', 'other'])).toMatch(/other people/);
  });
  it('a Team Member removes themselves only when self-assigned or creator', () => {
    expect(assignmentChangeProblem(tm, ctx(), [{ user_id: 'tm', created_by: 'tm' }], [])).toBeNull();
    expect(assignmentChangeProblem(tm, ctx('tm'), [{ user_id: 'tm', created_by: 'pm' }], [])).toBeNull();
    expect(assignmentChangeProblem(tm, ctx(), [{ user_id: 'tm', created_by: 'pm' }], [])).toBe('Ask the project manager to reassign this task');
  });
  it('a Team Member cannot remove someone else', () => {
    expect(assignmentChangeProblem(tm, ctx(), [{ user_id: 'other', created_by: 'pm' }], [])).toMatch(/other people/);
  });
});
