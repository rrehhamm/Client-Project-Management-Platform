import { describe, expect, it } from 'vitest';
import { formatMinutes, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it('accepts h:mm and decimal hours (FR-TIME-02)', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('0:05')).toBe(5);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('0.25')).toBe(15);
    expect(parseDuration(' 2 ')).toBe(120);
  });
  it('returns null for invalid input', () => {
    for (const bad of ['', '1:60', '1:5', 'abc', '-1', '1h', null, undefined]) {
      expect(parseDuration(bad)).toBeNull();
    }
  });
});

describe('formatMinutes', () => {
  it('formats minutes as h:mm', () => {
    expect(formatMinutes(90)).toBe('1:30');
    expect(formatMinutes(5)).toBe('0:05');
    expect(formatMinutes(1440)).toBe('24:00');
  });
});
