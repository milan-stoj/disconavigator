import { expect, test } from '@playwright/test';
import { acceptedBooking, addDays, uid } from './helpers';

const pastDate = () => {
  const year = 2001 + Math.floor(Math.random() * 9);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 27);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

test('a past-dated rental shows as overdue until it is paid', async ({ page }) => {
  const id = uid();
  const start = pastDate();
  const { bookingId } = await acceptedBooking(page, id, {
    bookingType: 'equipment_rental',
    startDate: start,
    endDate: addDays(start, 1),
  });

  await page.goto('/money-owed');
  await page.getByRole('textbox', { name: /search/i }).fill(`Silent disco ${id}`);
  const row = page.getByRole('row', { name: new RegExp(`Silent disco ${id}`) });
  await expect(row).toContainText('Overdue');
  await expect(row).toContainText('$500.00');

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}\\?tab=payments$`));
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Check' }).click();
  await dialog.getByLabel('Note').fill(`Check ${id}`);
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Payments' })).toContainText(`Check ${id}`);
  await expect(page.getByRole('region', { name: 'Money summary' })).toContainText('$0.00');

  await page.goto('/money-owed');
  await page.getByRole('textbox', { name: /search/i }).fill(`Silent disco ${id}`);
  await expect(page.getByText('Nothing owed. Every booking is paid up.')).toBeVisible();
});
