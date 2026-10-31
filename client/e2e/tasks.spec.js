// Phase 3 browser flows: tasks, board, subtasks, My Tasks and templates.
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Nexa-dev-2026';
// "Today" in the seeded workspace's timezone (My Tasks groups by it)
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

async function newProject(page, name, template) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client', { exact: true }).selectOption({ label: 'Nova Retail' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Project manager').selectOption({ label: 'Lina (Project Manager)' });
  if (template) await dialog.getByLabel('Start from template').selectOption({ label: template });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function quickAdd(page, title) {
  await page.getByRole('textbox', { name: 'New task title' }).fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId(`task-row-${title}`)).toBeVisible();
}

test('a PM plans tasks, completes a parent with subtasks on the board, and reuses the plan as a template', async ({ page }) => {
  const stamp = Date.now();
  const projectName = `E2E Tasks ${stamp}`;
  const design = `Design ${stamp}`; // unique, so My Tasks checks ignore earlier runs
  await signIn(page, 'lina.pm@nexa.test');
  await newProject(page, projectName);

  // FR-TSK-01: quick add in the List view
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await quickAdd(page, design);
  await quickAdd(page, 'Build');
  await quickAdd(page, 'Launch');

  // FR-TSK-04: a subtask, and "Assign me" + due today for My Tasks (FR-TSK-10)
  await page.getByTestId(`task-row-${design}`).getByRole('button', { name: design, exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('textbox', { name: 'Subtasks' }).fill('Wireframes');
  await panel.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(panel.getByRole('checkbox', { name: 'Wireframes' })).toBeVisible();
  await panel.getByRole('button', { name: 'Assign me' }).click();
  await expect(panel.getByRole('button', { name: 'Remove Lina' })).toBeVisible();
  await panel.getByLabel('Due date').fill(TODAY);
  await expect(panel.getByLabel('Due date')).toHaveValue(TODAY);
  await page.keyboard.press('Escape');

  // FR-TSK-10: it is in My Tasks under Today, and the link opens the task
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'My tasks' }).click();
  await page.getByRole('region', { name: /Today/ }).getByRole('link', { name: design }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: design })).toBeVisible();
  await page.keyboard.press('Escape');

  // TC-TSK-006: drag a card to another column on the Board
  await page.getByRole('button', { name: 'Board' }).click();
  const build = page.getByRole('button', { name: 'Drag Build to another column' });
  const target = page.getByTestId('column-InProgress');
  const from = await build.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(target.getByTestId('task-card-Build')).toBeVisible();

  // TC-TSK-002 / BR-TSK-02: Done with an open subtask asks to complete them all
  await page.getByTestId(`task-card-${design}`).getByRole('combobox').selectOption('Done');
  const prompt = page.getByRole('dialog');
  await expect(prompt).toContainText('Wireframes');
  await prompt.getByRole('button', { name: 'Complete all' }).click();
  await expect(page.getByTestId('column-Done').getByTestId(`task-card-${design}`)).toBeVisible();

  // My Tasks lists open tasks only: once Done it is gone
  await nav.getByRole('link', { name: 'My tasks' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByRole('link', { name: design })).toHaveCount(0);

  // FR-PRJ-02/03: save as template, then start a new project from it
  await nav.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: projectName }).click();
  await page.getByRole('button', { name: 'Save as template' }).click();
  const templateName = `E2E Template ${stamp}`;
  const saveDialog = page.getByRole('dialog');
  await saveDialog.getByLabel('Name', { exact: true }).fill(templateName);
  await saveDialog.getByRole('button', { name: 'Save as template' }).click();
  await expect(page.getByText(`Template "${templateName}" saved.`)).toBeVisible();

  const copyName = `E2E From Template ${stamp}`;
  await newProject(page, copyName, templateName);
  await page.getByRole('tab', { name: 'Tasks' }).click();
  for (const title of [design, 'Build', 'Launch']) await expect(page.getByTestId(`task-row-${title}`)).toBeVisible();
  // Templates start every task fresh: To do, no assignees (D-28)
  await expect(page.getByTestId(`task-row-${design}`)).toContainText('To do');
  await expect(page.getByTestId(`task-row-${design}`).getByLabel('Lina')).toHaveCount(0);
});

test('a Team Member has My Tasks but no Templates page', async ({ page }) => {
  await signIn(page, 'omar@nexa.test');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My tasks' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Templates' })).toHaveCount(0);
});
