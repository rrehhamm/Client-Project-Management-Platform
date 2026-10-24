// Remembers, across the redirect to /login, that the session just expired, so the
// login page can say so. Storage may be unavailable; then the notice is skipped.
const EXPIRED_FLAG = 'cpm_session_expired';

export function markSessionExpired() {
  try {
    sessionStorage.setItem(EXPIRED_FLAG, '1');
  } catch {
    // ignore
  }
}

/** True once, right after a session expired. */
export function consumeSessionExpiredFlag() {
  try {
    const v = sessionStorage.getItem(EXPIRED_FLAG) === '1';
    sessionStorage.removeItem(EXPIRED_FLAG);
    return v;
  } catch {
    return false;
  }
}
