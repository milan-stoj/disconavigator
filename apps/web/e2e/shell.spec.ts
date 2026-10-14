import { devices, expect, test } from '@playwright/test';

test('theme preference persists across reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('sidebar navigation works on desktop', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const sidebar = page.locator('[data-slot="sidebar"]');
  for (const [name, path] of [
    ['Pipeline', '/pipeline'],
    ['Inventory', '/inventory'],
    ['Money Owed', '/money-owed'],
    ['Settings', '/settings'],
    ['Dashboard', '/'],
  ] as const) {
    await sidebar.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  }
});

test('command palette navigates with the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder(/Go to a section/)).toBeFocused();
  await page.keyboard.type('calendar');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/calendar$/);
});

test.describe('mobile', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('sidebar opens as a sheet and navigates', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inventory', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Inventory', level: 1 })).toBeVisible();
  });
});
