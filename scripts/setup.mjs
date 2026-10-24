#!/usr/bin/env node
// One-command local setup: `npm run setup`, then `npm run dev`.
// Uses only Node built-ins so it runs before `npm install`.
//
//   --no-docker   use your own Postgres/S3/SMTP (from .env) instead of docker compose
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const noDocker = process.argv.includes('--no-docker') || process.env.SKIP_DOCKER === '1';

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const fail = (msg) => {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
};
const run = (command, { allowFail = false } = {}) => {
  const r = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0 && !allowFail) fail(`Command failed: ${command}`);
  return r.status === 0;
};

step('Checking Node.js version');
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail(`Node.js 24 or newer is required (found ${process.versions.node}). See .nvmrc.`);
console.log(`Node.js ${process.versions.node}`);

step('Preparing .env');
if (existsSync(resolve(root, '.env'))) {
  console.log('.env already exists — keeping it');
} else {
  copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
  console.log('Created .env from .env.example');
}

step('Installing dependencies');
run('npm install');

if (noDocker) {
  step('Skipping docker compose (--no-docker): using services from .env');
} else {
  step('Starting Postgres, MinIO and Mailpit (docker compose)');
  const hasDocker = spawnSync('docker compose version', { cwd: root, stdio: 'ignore', shell: true }).status === 0;
  if (!hasDocker) {
    fail(
      'Docker is not available. Install Docker Desktop, start it, and open a NEW terminal.\n' +
        '  On Windows, Docker Desktop needs WSL2 and hardware virtualization enabled in BIOS/UEFI.\n' +
        '  Or run `npm run setup -- --no-docker` with your own services configured in .env.',
    );
  }
  run('docker compose up -d --wait');
}

step('Applying database migrations');
run('npm run db:deploy -w server');

step('Loading seed data (BRD 19.1)');
run('npm run db:seed -w server');

step('Creating the file storage bucket');
if (!run('npm run storage:init -w server', { allowFail: noDocker })) {
  console.warn('Storage is not reachable. File features will not work until it is (see S3_* in .env).');
}

console.log(`
\x1b[32m✔ Setup complete.\x1b[0m Start the app with:  npm run dev

  App        http://localhost:5173
  API        http://localhost:4000/api/v1/health
  Mailpit    http://localhost:8025
  MinIO      http://localhost:9001

  Seed logins (password = SEED_PASSWORD in .env):
    owner@nexa.test, admin@nexa.test, lina.pm@nexa.test, omar@nexa.test,
    rana@nexa.test, sami.fin@nexa.test, maya@novaretail.test, ali@novaretail.test,
    omar.n@bright.test
`);
