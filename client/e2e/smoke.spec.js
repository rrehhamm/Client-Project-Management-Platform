import { expect, test } from '@playwright/test';

test('the public status page reaches the API', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByTestId('overall-status')).toBeVisible();
  // The database is always required; storage and mail depend on the environment.
  await expect(page.getByText('Database').locator('xpath=..')).toContainText('OK');
});

test('unknown pages show a not-found screen with a way home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to home' }).click();
  // Home is protected, so a signed-out visitor ends on the login page
  await expect(page).toHaveURL(/\/login$/);
});
