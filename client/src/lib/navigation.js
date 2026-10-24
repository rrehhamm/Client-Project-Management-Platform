// Only same-origin paths are accepted as a post-login destination (FR-AUTH-04),
// so a crafted ?next= cannot send the user to another site.
export function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  try {
    const url = new URL(next, 'http://same-origin.invalid');
    if (url.origin !== 'http://same-origin.invalid') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** /login?next=<current path> for redirects from protected pages. */
export function loginPathFor(location) {
  const here = `${location.pathname}${location.search}`;
  return here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`;
}
