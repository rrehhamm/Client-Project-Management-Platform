import { describe, expect, it } from 'vitest';
import { loginPathFor, safeNext } from './navigation';

describe('safeNext (FR-AUTH-04: same-origin paths only)', () => {
  it('keeps local paths with query and hash', () => {
    expect(safeNext('/team?page=2#top')).toBe('/team?page=2#top');
  });
  it('rejects anything that could leave the site', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

describe('loginPathFor', () => {
  it('carries the current location in ?next=', () => {
    expect(loginPathFor({ pathname: '/team', search: '?q=a' })).toBe('/login?next=%2Fteam%3Fq%3Da');
    expect(loginPathFor({ pathname: '/', search: '' })).toBe('/login');
  });
});
