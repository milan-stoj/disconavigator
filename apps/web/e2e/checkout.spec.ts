import { expect, test } from '@playwright/test';
import { acceptedBooking, json, uid } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('check out and check in a rental on a phone, then record found headphones', async ({
  page,
}) => {
  const id = uid();
  const { bookingId } = await acceptedBooking(page, id, { bookingType: 'equipment_rental' });
  await json(
    await page.request.post(`/api/bookings/${bookingId}/confirm`, {
      data: { reason: 'Paid cash' },
    }),
  );

  await page.goto(`/bookings/${bookingId}?tab=equipment`);
  await page.getByRole('main').getByRole('link', { name: 'Check out' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}/check-out$`));

  // One headphone short of the booking, so the mismatch has to be confirmed.
  await expect(page.getByRole('spinbutton', { name: 'Headphones' })).toHaveValue('10');
  await page.getByRole('button', { name: 'Decrease headphones' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Headphones' })).toHaveValue('9');
  await page.getByRole('button', { name: 'Increase headphones' }).click();
  await page.getByRole('button', { name: 'Increase headphones' }).click();
  await page.getByRole('button', { name: 'Decrease headphones' }).click();
  await page.getByRole('button', { name: 'Decrease headphones' }).click();
  await page
    .getByRole('group', { name: 'Transmitters' })
    .getByRole('button', { disabled: false })
    .first()
    .click();
  await page.getByRole('button', { name: 'Review' }).click();
  const outSummary = page.getByRole('list', { name: 'Check-out summary' });
  await expect(outSummary).toContainText('Booking needs 10');
  await page.getByRole('button', { name: 'Complete check-out' }).click();
  const mismatch = page.getByRole('alertdialog');
  await expect(mismatch).toContainText('Headphones: 9 going out, booking needs 10');
  await mismatch.getByRole('button', { name: 'Check out anyway' }).click();

  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}\\?tab=equipment$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Out');
  await expect(page.getByText(/Checked out .* by Kali/)).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Check in' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}/check-in$`));
  const returned = page.getByRole('spinbutton', { name: 'Headphones returned' });
  await expect(returned).toHaveValue('9');
  await returned.fill('7');
  await page.getByRole('button', { name: 'Increase headphones damaged' }).click();
  await page.getByRole('button', { name: 'Review' }).click();
  const inSummary = page.getByRole('list', { name: 'Check-in summary' });
  await expect(inSummary).toContainText('7 / 9');
  await expect(inSummary).toContainText('1 damaged · 2 missing');
  await expect(page.getByText('A $120.00 loss charge will be proposed')).toBeVisible();
  await page.getByRole('button', { name: 'Complete check-in' }).click();

  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}\\?tab=equipment$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Returned');
  const table = page.getByRole('table', { name: 'Equipment' });
  await expect(table.getByRole('row', { name: /Headphones/ })).toContainText('2');

  // Put the inventory back for other tests: both missing headphones turn up.
  await page.getByRole('button', { name: 'Record found items' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Increase headphones found' }).click();
  await dialog.getByLabel('Note (optional)').fill('In the van');
  await dialog.getByRole('button', { name: 'Record found' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Found items' })).toContainText('2 headphones');
  await expect(page.getByRole('button', { name: 'Record found items' })).toBeHidden();

  // The damaged headphone was taken out of service; put it back for other tests.
  const types = await json<{ id: string; name: string; outOfService: number }[]>(
    await page.request.get('/api/equipment'),
  );
  const headphones = types.find((t) => t.name === 'Headphones')!;
  await json(
    await page.request.put(`/api/equipment/${headphones.id}/out-of-service`, {
      data: { quantity: headphones.outOfService - 1, note: 'Repaired' },
    }),
  );
});
