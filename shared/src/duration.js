// Durations are stored as integer minutes (BR-TIME-05).
// Users may type "h:mm" or decimal hours (FR-TIME-02).

const HMM_RE = /^(\d+):([0-5]\d)$/;
const DECIMAL_HOURS_RE = /^\d+(?:\.\d+)?$/;

/** "1:30" → 90, "1.5" → 90, "0.25" → 15. Returns null when the text is not a duration. */
export function parseDuration(text) {
  const s = String(text ?? '').trim();
  const hmm = HMM_RE.exec(s);
  if (hmm) return Number(hmm[1]) * 60 + Number(hmm[2]);
  if (DECIMAL_HOURS_RE.test(s)) return Math.round(Number(s) * 60);
  return null;
}

/** 90 → "1:30". Display only; never changes the stored value. */
export function formatMinutes(minutes) {
  const m = Math.trunc(minutes);
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}
