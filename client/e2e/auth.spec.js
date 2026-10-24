// Phase 1 browser flows against the real API, dev database (seed) and Mailpit.
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Nexa-dev-2026';
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 8025}`;

async function signIn(page, email, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('TC-AUTH-003 / FR-AUTH-04: a signed-out visitor is sent to login and returns to the page afterwards', async ({ page }) => {
  await page.goto('/team');
  await expect(page).toHaveURL(/\/login\?next=%2Fteam$/);
  await signIn(page, 'owner@nexa.test');
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(page.getByTestId('user-row-lina.pm@nexa.test')).toBeVisible();
});

test('FR-AUTH-02: wrong credentials show the generic message', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'rana@nexa.test', 'Wrong-password-1');
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
  await expect(page).toHaveURL(/\/login/);
});

test('a Team Member lands on the dashboard without the Team page', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'omar@nexa.test');
  await expect(page.getByRole('heading', { name: /Welcome, Omar/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Team' })).toHaveCount(0);
  await page.goto('/team');
  await expect(page.getByText('You do not have access')).toBeVisible();
});

test('FR-AUTH-01: a Client Contact lands in the portal', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'maya@novaretail.test');
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText(/Nova Retail projects/)).toBeVisible();
});

test('FR-AUTH-05: signing out ends the session', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'sami.fin@nexa.test');
  await expect(page.getByRole('heading', { name: /Welcome, Sami/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('E2E-02 (part): Admin invites a Team Member, who sets a password from the email and signs in', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@nexa.test`;

  await page.goto('/login');
  await signIn(page, 'admin@nexa.test');
  await page.getByRole('link', { name: 'Team' }).click();
  await page.getByRole('button', { name: 'Invite person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Full name').fill('Rana E2E');
  await dialog.getByLabel('Role').selectOption('TeamMember');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await expect(page.getByTestId(`user-row-${email}`)).toContainText('Invited');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Read the invitation from Mailpit
  let link;
  await expect
    .poll(async () => {
      const search = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
      if (!search.messages?.length) return null;
      const message = await (await request.get(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json();
      link = message.Text.match(/https?:\/\/\S+\/accept-invite\?token=[\w-]+/)?.[0];
      return link ?? null;
    }, { timeout: 15_000 })
    .not.toBeNull();

  const { pathname, search } = new URL(link);
  await page.goto(`${pathname}${search}`);
  await expect(page.getByRole('heading', { name: 'Welcome to Nexa' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill('E2e-strong-pass-42');
  await page.getByLabel('Confirm password').fill('E2e-strong-pass-42');
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByRole('heading', { name: /Welcome, Rana E2E/ })).toBeVisible();
});
