// Money helpers. Amounts are integers in the currency's minor unit
// (JOD fils = 1/1000, USD/EUR cents = 1/100). All maths uses BigInt, so no
// floating-point error ever reaches a stored amount (BR-INV-04).
import { CURRENCIES } from './constants.js';

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Number of decimals for an ISO 4217 currency code we support. */
export function decimalsFor(currency) {
  const c = CURRENCIES[currency];
  if (!c) throw new RangeError(`Unsupported currency: ${currency}`);
  return c.decimals;
}

/**
 * Integer division rounded half away from zero ("half-up" for positive
 * amounts, mirrored for negative ones such as credit notes).
 */
export function divRoundHalfUp(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) throw new RangeError('Division by zero');
  const negative = n < 0n !== d < 0n;
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  let q = absN / absD;
  if ((absN % absD) * 2n >= absD) q += 1n;
  return negative ? -q : q;
}

/**
 * Convert a decimal amount ("12000", "33.5", 12.25) to minor units (BigInt).
 * By default extra decimals are an error; pass { round: true } to round half-up.
 */
export function toMinor(value, currency, { round = false } = {}) {
  const decimals = decimalsFor(currency);
  const text = typeof value === 'number' ? numberToPlainString(value) : String(value).trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new RangeError(`Not a decimal amount: ${value}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > decimals && !round) {
    throw new RangeError(`${currency} allows at most ${decimals} decimals: ${value}`);
  }
  const scale = 10n ** BigInt(frac.length);
  const raw = BigInt(whole + frac) * (sign ? -1n : 1n); // value * 10^frac.length
  const target = 10n ** BigInt(decimals);
  return frac.length > decimals ? divRoundHalfUp(raw * target, scale) : (raw * target) / scale;
}

/** Minor units → fixed decimal string, e.g. (12000000n, 'JOD') → "12000.000". */
export function fromMinor(minor, currency) {
  const decimals = decimalsFor(currency);
  const v = BigInt(minor);
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${whole}${decimals ? `.${frac}` : ''}`;
}

function numberToPlainString(n) {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite amount: ${n}`);
  const s = String(n);
  if (/e/i.test(s)) throw new RangeError(`Amount out of range: ${n}`);
  return s;
}
