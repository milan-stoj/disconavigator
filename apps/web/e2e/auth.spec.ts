import { expect, test } from '@playwright/test';
import { ADMIN, signIn } from './helpers';

// These tests exercise signing in themselves, so they start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test('signs in as kali and reaches the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveTitle('Disco Controller');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect username or password.')).toBeVisible();

  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Welcome back, Kali.')).toBeVisible();
  await expect(page.getByText('Undercover Dance Party')).toBeVisible();
});

test('signing out returns to sign-in and protects pages', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Account: Kali' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
});

test('an expired session redirects to sign-in and returns afterwards', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // Simulate expiry: the browser's session cookie is no longer valid on the server.
  await context.clearCookies();
  await page.getByRole('tab', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/sign-in\?.*expired=1/);
  await expect(page.getByText('Your session expired')).toBeVisible();
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/settings\?tab=users$/);
  await expect(page.getByRole('cell', { name: 'kali', exact: true })).toBeVisible();
});

test('admin creates a staff user who can sign in', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/settings?tab=users');
  await page.getByRole('button', { name: 'Add user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add user' });
  await dialog.getByLabel('Name', { exact: true }).fill('DJ Sam');
  await dialog.getByLabel('Username').fill('sam');
  await dialog.getByLabel('Temporary password').fill('sam-password-1');
  await dialog.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'DJ Sam', exact: true })).toBeVisible();

  const staff = await browser.newPage();
  await signIn(staff, { username: 'sam', password: 'sam-password-1' });
  await staff.goto('/settings');
  await expect(staff.getByText('Only admins can change settings.')).toBeVisible();
  await expect(staff.getByRole('tab', { name: 'Users' })).toHaveCount(0);
  await staff.close();
});
