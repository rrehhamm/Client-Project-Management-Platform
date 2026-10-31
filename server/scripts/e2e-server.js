// Starts the API for the browser tests (Playwright) on its own database.
// Each run: create the E2E database if missing, wipe it, apply migrations, load the
// BRD 19.1 seed, then start the API. The dev database is never touched.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const serverDir = resolve(import.meta.dirname, '..');
loadEnv({ path: resolve(serverDir, '../.env'), quiet: true });

/** E2E_DATABASE_URL, or DATABASE_URL with the database renamed to cpm_e2e. */
function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/cpm_e2e';
  return url.toString();
}

const url = e2eDatabaseUrl();
const dbName = new URL(url).pathname.replace(/^\//, '');
// Safety: never wipe a database that is not clearly the E2E one.
if (!/^[a-z0-9_]+_e2e$/.test(dbName)) {
  throw new Error(`Refusing to reset "${dbName}": the E2E database name must end in _e2e`);
}

// Create the database if this machine has never run the browser tests
const admin = new URL(url);
admin.pathname = '/postgres';
const server = new pg.Client({ connectionString: admin.toString() });
await server.connect();
const exists = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount === 0) await server.query(`CREATE DATABASE "${dbName}"`);
await server.end();

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await client.end();

// The API below and the setup commands all use the E2E database and bucket
process.env.DATABASE_URL = url;
process.env.S3_BUCKET = `${process.env.S3_BUCKET ?? 'cpm-files'}-e2e`;
const run = (cmd) => execSync(cmd, { cwd: serverDir, env: process.env, stdio: 'inherit' });
run('npx prisma migrate deploy');
run('node prisma/seed.js');
run('node scripts/init-storage.js');

console.log(`E2E database "${dbName}" reset and seeded`);
await import('../src/server.js');
