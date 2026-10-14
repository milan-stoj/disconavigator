import { expect, test } from '@playwright/test';

test('admin buys headphones and marks some out of service', async ({ page }) => {
  await page.goto('/inventory');
  const headphones = page.getByRole('region', { name: 'Headphones' });
  await expect(headphones.getByText('Owned')).toBeVisible();
  const owned = headphones.locator('dt', { hasText: 'Owned' }).locator('+ dd');
  await expect(owned).toHaveText('100');

  await headphones.getByRole('button', { name: 'Adjust quantity' }).click();
  const adjust = page.getByRole('dialog');
  await adjust.getByLabel('Quantity to add').fill('50');
  await adjust.getByLabel('Note').fill('Spring order');
  await adjust.getByRole('button', { name: 'Add to inventory' }).click();
  await expect(adjust).toBeHidden();
  await expect(owned).toHaveText('150');

  await headphones.getByRole('button', { name: 'Set out of service' }).click();
  const oos = page.getByRole('dialog');
  await oos.getByLabel('Number out of service').fill('5');
  await oos.getByRole('button', { name: 'Save' }).click();
  await expect(oos).toBeHidden();
  await expect(headphones.locator('dt', { hasText: 'In service' }).locator('+ dd')).toHaveText(
    '145',
  );

  await headphones.getByRole('button', { name: 'More for Headphones' }).click();
  await page.getByRole('menuitem', { name: 'View history' }).click();
  const history = page.getByRole('dialog', { name: 'Headphones history' });
  await expect(history.getByRole('row', { name: /Purchased.*Spring order.*\+50/ })).toBeVisible();
  await expect(history.getByRole('row', { name: /Out of service.*5/ })).toBeVisible();
});

test('admin creates the "Party 50" package', async ({ page }) => {
  await page.goto('/inventory');
  await page.getByRole('tab', { name: 'Packages' }).click();
  await expect(page).toHaveURL(/tab=packages/);
  await page.getByRole('button', { name: 'New package' }).click();

  const editor = page.getByRole('dialog', { name: 'New package' });
  await editor.getByLabel('Name').fill('Party 50');
  await editor.getByLabel('Price').fill('300');
  await editor.getByLabel('Included days').fill('2');
  await editor.getByLabel('Per extra day').fill('75');

  const items = editor.getByRole('list', { name: 'Included equipment' }).getByRole('listitem');
  await expect(items.first().getByRole('combobox', { name: 'Equipment' })).toHaveText('Headphones');
  await items.first().getByLabel('Quantity').fill('50');
  await items.first().getByLabel('Loss fee each').fill('60');

  await editor.getByRole('button', { name: 'Add equipment' }).click();
  await expect(items.nth(1).getByRole('combobox', { name: 'Equipment' })).toHaveText(
    'Transmitters',
  );
  await editor.getByRole('button', { name: 'Create package' }).click();
  await expect(items.nth(1).getByText('Enter a quantity')).toBeVisible();
  await items.nth(1).getByLabel('Quantity').fill('1');
  await editor.getByRole('button', { name: 'Create package' }).click();
  await expect(editor).toBeHidden();

  const table = page.getByRole('table', { name: 'Rental packages' });
  const row = table.getByRole('row', { name: /Party 50/ });
  await expect(row).toContainText('50 × Headphones, 1 × Transmitters');
  await expect(row).toContainText('$300.00');
  await expect(row).toContainText('2 days');
  await expect(row).toContainText('Active');

  await row.click();
  const edit = page.getByRole('dialog', { name: 'Edit Party 50' });
  await expect(edit.getByLabel('Price')).toHaveValue('300');
  await edit.getByRole('switch', { name: 'Available for new quotes' }).click();
  await edit.getByRole('button', { name: 'Save package' }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText('Inactive');
});
