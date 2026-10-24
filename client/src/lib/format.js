// Display formatting. Timestamps are shown in the viewer's timezone, falling back
// to the workspace timezone (NFR-TZ-01). Money arrives in minor units.
import { fromMinor } from '@cpm/shared';
import { t } from '@/i18n';

export function formatDateTime(iso, timeZone) {
  if (!iso) return t('common.never');
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function formatMoney(minor, currency) {
  if (minor === null || minor === undefined) return t('common.none');
  return `${fromMinor(minor, currency)} ${currency}`;
}

/** Time zones the browser knows, for pickers. */
export function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}
