// Process entry point: start HTTP server, shut down cleanly on SIGINT/SIGTERM.
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './lib/db.js';
import { logger } from './lib/logger.js';

const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, `API listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  // Force exit if open connections keep the server alive
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
});
