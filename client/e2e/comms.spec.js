// Phase 4 browser flows: E2E-02 (onboard a team member), E2E-05 (unauthorised
// attempts), and comments, mentions, notifications, files, dashboard and search.
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Nexa-dev-2026';
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 8025}`;

async function signIn(page, email, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const nav = (page) => page.getByRole('navigation', { name: 'Main navigation' });

/** The CSRF token the browser holds, for API calls made from the test (BR-AUTH-03). */
async function csrf(page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === 'cpm_csrf');
  return decodeURIComponent(cookie.value);
}

async function projectIdByCode(page, code) {
  const res = await page.request.get(`/api/v1/projects?q=${code}`);
  return (await res.json()).data.find((p) => p.code === code).id;
}

test('E2E-02: Admin invites Rana, she activates, the PM adds her to Project B, and she sees only Project B', async ({ page, browser, request }) => {
  const email = `e2e-rana-${Date.now()}@nexa.test`;
  const name = `Rana ${Date.now() % 100000}`;

  // Admin invites a Team Member
  await signIn(page, 'admin@nexa.test');
  await nav(page).getByRole('link', { name: 'Team' }).click();
  await page.getByRole('button', { name: 'Invite person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Role').selectOption('TeamMember');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  const projectA = await projectIdByCode(page, 'NOV-001');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // She sets a password from the email
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
  const rana = await browser.newPage();
  const { pathname, search } = new URL(link);
  await rana.goto(`${pathname}${search}`);
  await rana.getByLabel('Password', { exact: true }).fill('E2e-strong-pass-42');
  await rana.getByLabel('Confirm password').fill('E2e-strong-pass-42');
  await rana.getByRole('button', { name: 'Activate account' }).click();
  await expect(rana.getByRole('heading', { name: new RegExp(`Welcome, ${name}`) })).toBeVisible();

  // The PM adds her to Project B
  await signIn(page, 'lina.pm@nexa.test');
  await nav(page).getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Corporate Website' }).click();
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel('Team member', { exact: true }).selectOption({ label: `${name} (Team Member)` });
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByText(name)).toBeVisible();

  // She sees only Project B: project list, dashboard and search
  await rana.reload();
  await expect(rana.getByRole('link', { name: 'Corporate Website' })).toBeVisible(); // dashboard "My projects"
  await expect(rana.getByRole('link', { name: 'E-Commerce Platform' })).toHaveCount(0);
  await nav(rana).getByRole('link', { name: 'Projects' }).click();
  await expect(rana.getByRole('link', { name: 'Corporate Website' })).toBeVisible();
  await expect(rana.getByRole('link', { name: 'E-Commerce Platform' })).toHaveCount(0);
  const box = rana.getByRole('searchbox', { name: /Search clients/ });
  await box.fill('E-Commerce');
  await expect(rana.getByText('No results for "E-Commerce".')).toBeVisible();
  await box.fill('Corporate');
  await expect(rana.getByRole('region', { name: 'Projects' }).getByRole('button', { name: /Corporate Website/ })).toBeVisible();

  // Any request for Project A returns 403/404 (expected final state)
  const res = await rana.request.get(`/api/v1/projects/${projectA}`);
  expect([403, 404]).toContain(res.status());
  await rana.goto(`/projects/${projectA}`);
  await expect(rana.getByRole('alert')).toBeVisible();
});

test('E2E-05: signed-out, Team Member and contact attempts are refused, change nothing, and appear in the audit log', async ({ page, browser }) => {
  // Signed out: /projects goes to login, and the private API answers 401
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
  expect((await page.request.get('/api/v1/projects')).status()).toBe(401);

  // Omar (Team Member) calls DELETE on a project → 403
  const omar = await browser.newPage();
  await signIn(omar, 'omar@nexa.test');
  await expect(nav(omar)).toBeVisible();
  const projectA = await projectIdByCode(omar, 'NOV-001');
  const del = await omar.request.delete(`/api/v1/projects/${projectA}`, { headers: { 'X-CSRF-Token': await csrf(omar) } });
  expect(del.status()).toBe(403);

  // Maya (Nova contact) asks for a Client B project by id → 404, nothing returned
  await signIn(page, 'admin@nexa.test');
  await expect(nav(page)).toBeVisible();
  const projectB = await projectIdByCode(page, 'BRI-001');
  const maya = await browser.newPage();
  await signIn(maya, 'maya@novaretail.test');
  await expect(maya).toHaveURL(/\/portal/);
  const peek = await maya.request.get(`/api/v1/projects/${projectB}`);
  expect(peek.status()).toBe(404);
  expect(JSON.stringify(await peek.json())).not.toContain('Corporate Website');

  // The project still exists, and every attempt is in the audit log
  expect((await page.request.get(`/api/v1/projects/${projectA}`)).status()).toBe(200);
  await nav(page).getByRole('link', { name: 'Audit log' }).click();
  await page.getByLabel('Action').fill('access.denied');
  await expect(page.getByRole('cell', { name: 'Omar' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Maya' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Signed-out visitor' }).first()).toBeVisible();
});

test('a PM comments with a mention and uploads a file; Omar is notified, opens the task and sees both', async ({ page, browser }) => {
  const stamp = Date.now();
  const title = `Hero banner ${stamp}`;
  await signIn(page, 'lina.pm@nexa.test');
  await nav(page).getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'E-Commerce Platform' }).click();

  // A task, and a comment that mentions Omar (FR-COM-03)
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.getByRole('textbox', { name: 'New task title' }).fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId(`task-row-${title}`).getByRole('button', { name: title, exact: true }).click();
  const panel = page.getByRole('dialog');
  const editor = panel.getByRole('textbox', { name: 'New comment' });
  await editor.click();
  await editor.pressSequentially('Please review @Om');
  await panel.getByRole('list', { name: 'People you can mention' }).getByRole('button', { name: 'Omar' }).click();
  await editor.pressSequentially('today');
  await panel.getByRole('button', { name: 'Post' }).click();
  await expect(panel.getByText('Please review @Omar today')).toBeVisible();
  await expect(panel.locator('[data-testid^="comment-"]').filter({ hasText: 'Please review' }).getByText('Internal', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // A file on the Files tab (FR-FILE-01), previewable (FR-FILE-03)
  await page.getByRole('tab', { name: 'Files' }).click();
  const fileName = `brief-${stamp}.pdf`;
  await page.getByLabel('Upload files').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n') });
  await expect(page.getByText(`"${fileName}" uploaded.`)).toBeVisible();
  await page.getByRole('button', { name: `Open ${fileName}` }).click();
  await expect(page.getByRole('dialog').getByTitle(fileName)).toBeVisible(); // PDF preview frame
  await page.keyboard.press('Escape');

  // An executable is refused by type (TC-FILE-001)
  await page.getByLabel('Upload files').setInputFiles({ name: 'invoice.exe', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]) });
  await expect(page.getByText(/"invoice.exe" was not uploaded: \.exe files are not allowed/)).toBeVisible();

  // Omar: the bell shows the mention; clicking opens the task with the comment
  const omar = await browser.newPage();
  await signIn(omar, 'omar@nexa.test');
  const bell = omar.getByRole('button', { name: /Notifications \(\d+ unread\)/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await omar.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(`Lina mentioned you on "${title}"`) }).click();
  await expect(omar.getByRole('dialog').getByText('Please review @Omar today')).toBeVisible();
});
