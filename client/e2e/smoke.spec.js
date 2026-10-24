import { expect, test } from '@playwright/test';

test('app shell loads and reaches the API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Client Project Management' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  // The database is always required; storage and mail depend on the environment.
  await expect(page.getByTestId('overall-status')).toBeVisible();
  await expect(page.getByText('Database').locator('xpath=..')).toContainText('OK');
});

test('unknown pages show a not-found screen with a way home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to home' }).click();
  await expect(page).toHaveURL('/');
});
