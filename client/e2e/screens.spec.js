// D-45 before/after screenshots of the main screens. Runs only on request:
//   SCREENSHOTS=../shots/before npx playwright test screens -w client   (from the repo root: cd client first)
// Captures every screen in light and dark (desktop), and key screens at phone width.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const OUT = process.env.SCREENSHOTS;
const PASSWORD = process.env.SEED_PASSWORD ?? 'Nexa-dev-2026';

test.skip(!OUT, 'Set SCREENSHOTS=<folder> to capture screenshots');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
test.use({ actionTimeout: 5_000 });

async function signIn(page, email, portal = false) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (!portal) await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

async function shot(page, name) {
  // The app polls (notifications), so the network is never idle: wait for skeletons instead.
  await page.waitForLoadState('load');
  await page
    .locator('[data-slot="skeleton"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
}

async function tryStep(fn) {
  try {
    await fn();
  } catch {
    // A missing control on one screen must not stop the rest of the capture.
  }
}

for (const scheme of ['light', 'dark']) {
  test(`internal screens (${scheme})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto('/login');
    await shot(page, `${scheme}-01-login`);
    await signIn(page, 'lina.pm@nexa.test');
    await shot(page, `${scheme}-02-dashboard`);
    for (const [n, path] of [
      ['03-projects', '/projects'],
      ['05-clients', '/clients'],
      ['07-my-tasks', '/my-tasks'],
      ['08-search', '/search?q=web'],
      ['09-account', '/account'],
    ]) {
      await page.goto(path);
      await shot(page, `${scheme}-${n}`);
    }
    await page.goto('/projects');
    await tryStep(async () => {
      await page.locator('main a[href^="/projects/"]').first().click();
      await shot(page, `${scheme}-04a-project-overview`);
      await page.getByRole('tab', { name: 'Tasks' }).click();
      await shot(page, `${scheme}-04b-project-tasks-list`);
      await tryStep(async () => {
        await page.getByRole('button', { name: 'Board' }).click();
        await shot(page, `${scheme}-04c-project-board`);
      });
      await tryStep(async () => {
        await page.getByRole('button', { name: 'Calendar' }).click();
        await shot(page, `${scheme}-04d-project-calendar`);
      });
      await tryStep(async () => {
        await page.getByRole('tab', { name: 'Files' }).click();
        await shot(page, `${scheme}-04e-project-files`);
      });
    });
    await page.goto('/clients');
    await tryStep(async () => {
      await page.locator('main a[href^="/clients/"]').first().click();
      await shot(page, `${scheme}-06-client-detail`);
    });
    await ctx.close();

    const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const ap = await admin.newPage();
    await signIn(ap, 'owner@nexa.test');
    for (const [n, path] of [
      ['10-settings', '/settings'],
      ['11-team', '/team'],
      ['12-audit', '/audit'],
    ]) {
      await ap.goto(path);
      await shot(ap, `${scheme}-${n}`);
    }
    await admin.close();

    const portal = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const pp = await portal.newPage();
    await tryStep(async () => {
      await signIn(pp, 'maya@novaretail.test', true);
      await shot(pp, `${scheme}-20-portal-home`);
    });
    await portal.close();
  });
}

test('phone width (light)', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await shot(page, 'mobile-01-login');
  await signIn(page, 'lina.pm@nexa.test');
  await shot(page, 'mobile-02-dashboard');
  await page.goto('/projects');
  await shot(page, 'mobile-03-projects');
  await page.goto('/my-tasks');
  await shot(page, 'mobile-07-my-tasks');
  await ctx.close();
});
