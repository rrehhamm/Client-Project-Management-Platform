// Phase 2 browser flows: client → contact → project → milestone → status → archive.
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Nexa-dev-2026';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

test('TC-AUTH-003 (page): a signed-out visit to /projects goes to /login?next=/projects and back', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
  await page.getByLabel('Email').fill('lina.pm@nexa.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('a PM creates a client, adds a contact, runs a project through its lifecycle and archives it', async ({ page }) => {
  const stamp = Date.now();
  const clientName = `E2E Client ${stamp}`;
  const projectName = `E2E Website ${stamp}`;
  await signIn(page, 'lina.pm@nexa.test');

  // Client (FR-CLI-01) with a suggested prefix (D-02)
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'New client' }).click();
  const clientDialog = page.getByRole('dialog');
  await clientDialog.getByLabel('Name').fill(clientName);
  await expect(clientDialog.getByLabel('Project code prefix')).toHaveValue(/^[A-Z]{3}$/);
  await clientDialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible();

  // Contact (FR-CON-01/02): first contact becomes primary with commercial authority (D-16)
  await page.getByRole('tab', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'Add contact' }).click();
  const contactDialog = page.getByRole('dialog');
  await contactDialog.getByLabel('Full name').fill('Dana E2E');
  await contactDialog.getByLabel('Email').fill(`dana-${stamp}@client.test`);
  await contactDialog.getByRole('button', { name: 'Save changes' }).click();
  const contactRow = page.getByTestId(`contact-row-dana-${stamp}@client.test`);
  await expect(contactRow).toContainText('Primary');
  await expect(contactRow).toContainText('Can sign and pay');

  // Project (FR-PRJ-01) from the client's Projects tab
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog');
  await projectDialog.getByLabel('Name').fill(projectName);
  await projectDialog.getByLabel('Project manager').selectOption({ label: 'Lina (Project Manager)' });
  await projectDialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByText(/^[A-Z]{3}-001$/)).toBeVisible();
  await expect(page.getByText('Not started')).toBeVisible();

  // Milestone (FR-MS-01) and completion (FR-MS-03)
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await page.getByRole('button', { name: 'Add milestone' }).click();
  const msDialog = page.getByRole('dialog');
  await msDialog.getByLabel('Title').fill('Launch');
  await msDialog.getByLabel('Due date').fill('2026-12-01');
  await msDialog.getByRole('button', { name: 'Save changes' }).click();
  const milestone = page.getByTestId('milestone-Launch');
  await expect(milestone).toBeVisible();
  await milestone.getByRole('button', { name: 'Complete' }).click();
  await expect(milestone).toContainText('Completed');

  // Status lifecycle (BRD 16.1)
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Status changed to In progress.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Status changed to Completed.')).toBeVisible();

  // Archive (FR-PRJ-10): read-only
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('This project is archived and read-only.')).toBeVisible();

  // Activity is recorded (FR-ACT-01)
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Lina archived the project')).toBeVisible();
  await expect(page.getByText('Lina created the project')).toBeVisible();
});

test('a Team Member sees their projects without budgets and has no Clients page', async ({ page }) => {
  await signIn(page, 'omar@nexa.test');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Clients' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'E-Commerce Platform' }).click();
  await expect(page.getByText('NOV-001')).toBeVisible();
  await expect(page.getByText('Budget')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Put on hold' })).toHaveCount(0);
});
