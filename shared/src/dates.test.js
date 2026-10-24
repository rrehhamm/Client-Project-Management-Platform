import { describe, expect, it } from 'vitest';
import { isIsoDate, isValidTimeZone, todayInTimeZone } from './dates.js';

describe('todayInTimeZone (NFR-TZ-01)', () => {
  // 2026-10-24 22:30 UTC is already the 25th in Amman (UTC+3) but still the 24th in UTC-5.
  const instant = new Date('2026-10-24T22:30:00Z');
  it('uses the given timezone, not the machine one', () => {
    expect(todayInTimeZone('Asia/Amman', instant)).toBe('2026-10-25');
    expect(todayInTimeZone('America/Bogota', instant)).toBe('2026-10-24');
    expect(todayInTimeZone('UTC', instant)).toBe('2026-10-24');
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-11-10')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate('2026-11-10T00:00:00Z')).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Asia/Amman')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
