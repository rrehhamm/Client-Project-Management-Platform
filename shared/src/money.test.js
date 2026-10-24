import { describe, expect, it } from 'vitest';
import { decimalsFor, divRoundHalfUp, fromMinor, toMinor } from './money.js';

describe('decimalsFor', () => {
  it('uses each currency own exponent (JOD 3, USD/EUR 2)', () => {
    expect(decimalsFor('JOD')).toBe(3);
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('EUR')).toBe(2);
  });
  it('rejects unknown currencies', () => {
    expect(() => decimalsFor('GBP')).toThrow(RangeError);
  });
});

describe('toMinor', () => {
  it('stores 12,000 JOD as 12000000 fils (seed Project A budget)', () => {
    expect(toMinor('12000', 'JOD')).toBe(12_000_000n);
  });
  it('converts strings and numbers', () => {
    expect(toMinor('33.5', 'USD')).toBe(3350n);
    expect(toMinor(12.25, 'EUR')).toBe(1225n);
    expect(toMinor('0.001', 'JOD')).toBe(1n);
    expect(toMinor('-10.50', 'USD')).toBe(-1050n);
  });
  it('rejects more decimals than the currency allows unless rounding is asked for', () => {
    expect(() => toMinor('1.005', 'USD')).toThrow(RangeError);
    expect(toMinor('1.005', 'USD', { round: true })).toBe(101n);
    expect(toMinor('1.0045', 'JOD', { round: true })).toBe(1005n);
    expect(toMinor('-1.005', 'USD', { round: true })).toBe(-101n);
  });
  it('rejects text that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1,000', '1e3', '.5', '5.']) {
      expect(() => toMinor(bad, 'USD')).toThrow(RangeError);
    }
    expect(() => toMinor(Number.NaN, 'USD')).toThrow(RangeError);
  });
  it('avoids floating-point error', () => {
    expect(toMinor(0.1 + 0.2, 'USD', { round: true })).toBe(30n);
  });
});

describe('fromMinor', () => {
  it('formats with the currency decimals', () => {
    expect(fromMinor(12_000_000n, 'JOD')).toBe('12000.000');
    expect(fromMinor(5, 'USD')).toBe('0.05');
    expect(fromMinor(-1050n, 'EUR')).toBe('-10.50');
  });
  it('round-trips toMinor', () => {
    expect(fromMinor(toMinor('987.654', 'JOD'), 'JOD')).toBe('987.654');
  });
});

describe('divRoundHalfUp', () => {
  it('rounds halves away from zero', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(5n, -2n)).toBe(-3n);
  });
  it('rejects division by zero', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});
