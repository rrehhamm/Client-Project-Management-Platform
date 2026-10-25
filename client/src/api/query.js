/** "?a=1&b=x" from an object, skipping empty values. */
export function toQueryString(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
