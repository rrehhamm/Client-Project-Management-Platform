import { ERROR_CODES } from '@cpm/shared';
import { checkReadiness } from './service.js';

/** Liveness: the process is up. No dependencies touched. */
export function live(_req, res) {
  res.json({ status: 'ok' });
}

/** Readiness: database, storage and mail all reachable. 503 if any is down. */
export async function ready(_req, res) {
  const { ready: ok, checks } = await checkReadiness();
  if (ok) return res.json({ status: 'ok', checks });
  return res.status(503).json({
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'One or more services are unavailable',
    fields: [],
    checks,
  });
}
