// Structured JSON logs with the request ID on every line (NFR-OBS-01).
// Secrets and personal data are redacted; request bodies are never logged.
import pino from 'pino';
import { config } from '../config.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.secret',
];

export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  base: { service: 'cpm-api' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
