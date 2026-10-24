// Runs once before the server test suite: wipes the TEST database, applies all
// migrations and loads the BRD 19.1 seed, so every run starts from the same state.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';

const serverDir = resolve(import.meta.dirname, '..');

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');

  // Safety: never wipe a database that is not clearly a test database.
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": TEST_DATABASE_URL must point at a database ending in _test`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', BCRYPT_COST: '4' };
  const run = (cmd) => execSync(cmd, { cwd: serverDir, env, stdio: 'pipe' });
  run('npx prisma migrate deploy');
  run('node prisma/seed.js');
}
