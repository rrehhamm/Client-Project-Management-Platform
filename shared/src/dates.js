// Date-only values (due dates, entry dates) are calendar days in the
// workspace timezone (BR-PRJ-07, NFR-TZ-01), passed around as "YYYY-MM-DD".

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in an IANA timezone, as "YYYY-MM-DD". */
export function todayInTimeZone(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isIsoDate(text) {
  if (typeof text !== 'string' || !ISO_DATE_RE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** True when the timezone name is valid (e.g. "Asia/Amman"). */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
