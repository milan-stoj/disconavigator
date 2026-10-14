import { expect, test } from '@playwright/test';
import { acceptedBooking, json, uid } from './helpers';

test('confirm a rental without a deposit and send the confirmation', async ({ page }) => {
  const id = uid();
  const { bookingId } = await acceptedBooking(page, id, { bookingType: 'equipment_rental' });

  await page.goto('/bookings');
  await page.getByRole('textbox', { name: /search/i }).fill(`Silent disco ${id}`);
  await page.getByRole('row', { name: new RegExp(`Silent disco ${id}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}$`));
  await expect(page.getByText(/Waiting for the \$100\.00 holding deposit/)).toBeVisible();

  await page.getByRole('button', { name: 'Confirm without deposit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/reason/i).fill('Paid cash at the office');
  await dialog.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Confirmed');

  await page.getByRole('tab', { name: 'Logistics' }).click();
  await page.getByRole('radio', { name: 'We deliver' }).click();
  await page.getByLabel('Delivery time').fill('15:00');
  await page.getByLabel('Delivery address').fill('500 Main St, Waukesha');
  await page.getByLabel('Notes for the customer').fill('Charge headphones overnight.');
  await page.getByRole('button', { name: 'Save logistics' }).click();
  await expect(page.getByText('Logistics saved')).toBeVisible();

  await page.getByRole('button', { name: 'Send confirmation' }).click();
  await expect(page.getByText(`Confirmation sent to sam-${id}@example.test`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend confirmation' })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText(/Confirmed without deposit: Paid cash at the office/)).toBeVisible();
});

test('staff a door-split night, print its sheet, settle and close it', async ({ page }) => {
  const id = uid();
  await json<{ id: string }>(await page.request.post('/api/staff', { data: { name: `DJ ${id}` } }));
  const { bookingId, phone } = await acceptedBooking(page, id, {
    bookingType: 'full_service',
    pricingTerm: 'door_split',
    splitBps: 4000,
    lines: [],
  });

  await page.goto(`/bookings/${bookingId}?tab=staffing`);
  await page.getByLabel('Load-in').fill('19:30');
  await page.getByLabel('Run of show').fill('9pm doors, 10pm theme set');
  await page.getByRole('button', { name: 'Save event details' }).click();
  await expect(page.getByText('Event details saved')).toBeVisible();
  await page.getByRole('checkbox', { name: `DJ ${id}` }).check();
  await page.getByRole('button', { name: 'Save DJs' }).click();
  await expect(page.getByText('DJs saved')).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Event sheet' }).first().click();
  const sheet = page.getByRole('article');
  await expect(sheet.getByRole('list', { name: 'DJs' })).toContainText(`DJ ${id}`);
  await expect(sheet).toContainText('7:30 PM');
  await expect(sheet.getByRole('link', { name: phone })).toHaveAttribute('href', `tel:${phone}`);

  await page.goto(`/bookings/${bookingId}`);
  await page.getByRole('button', { name: 'Record settlement' }).click();
  const settle = page.getByRole('dialog');
  await settle.getByLabel('Door revenue').fill('1500');
  await expect(settle).toContainText('Amount owed: $600.00');
  await settle.getByRole('button', { name: 'Record settlement' }).click();
  await expect(settle).toBeHidden();
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByRole('region', { name: 'Money summary' })).toContainText('$600.00');

  // Equipment hasn't been checked back in, so closing needs an admin override.
  await page.getByRole('button', { name: 'Close booking' }).click();
  const close = page.getByRole('dialog');
  await expect(close.getByRole('list', { name: 'Close blockers' })).toContainText(/checked in/i);
  await close.getByLabel(/reason/i).fill('Bar paid in person, gear counted on site');
  await close.getByRole('button', { name: 'Close anyway' }).click();
  await expect(close).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed');
});
