import { expect, test, type Page } from '@playwright/test';
import { addDays, json, randomDate, uid } from './helpers';

/** Connects the mock Square account; the signature key lets the dev pay route send webhooks. */
async function connectSquare(page: Page) {
  await json(
    await page.request.put('/api/settings/square', {
      data: {
        environment: 'sandbox',
        accessToken: 'e2e-sandbox-token',
        locationId: 'MOCK-LOC-1',
        webhookSignatureKey: 'e2e-signature-key',
      },
    }),
  );
}
const runJobs = async (page: Page) => json(await page.request.post('/api/dev/jobs/run'));

test.afterEach(async ({ page }) => {
  // Other specs expect Square to be disconnected.
  await page.request.delete('/api/settings/square');
});

test('equipment rental from quote request to closed booking', async ({ page, browser }) => {
  const id = uid();
  const orgName = `Riverwest Fest ${id}`;
  const date = randomDate();
  await connectSquare(page);

  // A package of 50 headphones and a transmitter, $300 for up to three days.
  const types = await json<{ id: string; name: string }[]>(
    await page.request.get('/api/equipment'),
  );
  const typeId = (n: string) => types.find((t) => t.name === n)!.id;
  const pkg = `Fest 50 ${id}`;
  await json(
    await page.request.post('/api/packages', {
      data: {
        name: pkg,
        priceCents: 30_000,
        includedDays: 3,
        extraDayPriceCents: 7_500,
        items: [
          { equipmentTypeId: typeId('Headphones'), quantity: 50 },
          { equipmentTypeId: typeId('Transmitters'), quantity: 1 },
        ],
      },
    }),
  );

  // 1. A visitor requests a rental quote on the public form.
  const visitor = await browser.newContext({ storageState: undefined });
  const form = await visitor.newPage();
  await form.goto('/request/undercover-dance-party');
  await form.getByRole('radio', { name: /Rent the headphones/ }).check();
  await form.getByLabel('Event date').fill(date);
  await form.getByLabel('Expected guests').fill('50');
  await form.getByLabel('Event location').fill('Lake Geneva, WI');
  await form.getByLabel('Your name').fill(`Morgan ${id}`);
  await form.getByLabel('Organization (optional)').fill(orgName);
  await form.getByLabel('Email').fill(`morgan-${id}@example.test`);
  await form.getByRole('button', { name: 'Request a quote' }).click();
  await expect(form.getByRole('heading', { name: 'Thanks, we got your request' })).toBeVisible();
  await visitor.close();

  // 2. Staff find it in the pipeline and build a quote with the package and a delivery fee.
  await page.goto('/pipeline');
  const requested = page.getByRole('region', { name: /^Quote Requested \d+$/ });
  await requested.getByRole('link', { name: new RegExp(orgName) }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(orgName) })).toBeVisible();
  await page.getByRole('link', { name: 'New quote' }).click();
  await expect(page.getByRole('radio', { name: /Equipment rental/ })).toBeChecked();
  await expect(page.getByLabel('Pickup date')).toHaveValue(date);
  await page.getByLabel('Return date').fill(addDays(date, 2));
  await page.getByLabel('Delivery or pickup location').fill('Lake Geneva, WI');
  await page.getByRole('combobox', { name: 'Add a package' }).click();
  await page.getByRole('option', { name: new RegExp(pkg) }).click();
  await page.getByRole('switch', { name: 'Inside the service area' }).click();
  const lines = page.getByRole('list', { name: 'Line items' });
  await expect(lines.getByLabel('Delivery fee')).toHaveValue('Delivery outside service area');
  const totals = page.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('Total$375.00');
  await expect(totals).toContainText('Holding deposit (20%)$75.00');
  await page.getByRole('button', { name: 'Create quote' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Quote Q-\d+/ })).toBeVisible();
  const quoteUrl = page.url();

  // 3. Send it; the customer accepts on the public page.
  await page.getByRole('button', { name: 'Send quote' }).click();
  await expect(page.getByText(`sent to morgan-${id}@example.test`)).toBeVisible();
  const quoteId = quoteUrl.split('/quotes/')[1]!;
  const quote = await json<{ current: { publicUrl: string } }>(
    await page.request.get(`/api/quotes/${quoteId}`),
  );
  const customer = await browser.newContext({ storageState: undefined });
  const view = await customer.newPage();
  await view.goto(new URL(quote.current.publicUrl).pathname);
  await view.getByRole('checkbox', { name: 'I agree to the rental terms above' }).check();
  await view.getByLabel('Type your full name to sign').fill(`Morgan ${id}`);
  await view.getByRole('button', { name: 'Accept quote' }).click();
  await expect(view.getByRole('status')).toContainText('Quote accepted');
  await customer.close();

  await page.goto(quoteUrl);
  const bookings = page.getByRole('list', { name: 'Bookings' });
  await expect(bookings).toContainText('Awaiting deposit');
  await bookings.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/bookings\/[^/?]+/);
  const bookingId = new URL(page.url()).pathname.split('/')[2]!;

  // 4. Square invoices the deposit; the customer pays it and the webhook confirms the booking.
  await runJobs(page);
  const withInvoice = await json<{ invoices: { id: string; squareInvoiceId: string | null }[] }>(
    await page.request.get(`/api/bookings/${bookingId}`),
  );
  const invoiceId = withInvoice.invoices[0]!.id;
  expect(withInvoice.invoices[0]!.squareInvoiceId).toBeTruthy();
  await json(await page.request.post(`/api/dev/square/invoices/${invoiceId}/pay`));
  await runJobs(page);

  await page.goto(`/bookings/${bookingId}?tab=payments`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Confirmed');
  const money = page.getByRole('region', { name: 'Money summary' });
  await expect(money).toContainText('Paid$75.00');
  await expect(money).toContainText('Balance$300.00');
  await expect(page.getByRole('list', { name: 'Payments' })).toContainText('Square');

  // 5. The calendar shows a confirmed hold.
  await page.goto(`/calendar?view=month&date=${date}`);
  await expect(
    page.locator(`[role="gridcell"][data-date="${date}"] [data-strength="confirmed"]`),
  ).toContainText(orgName);

  // The customer pays the balance before pickup.
  await json(await page.request.post(`/api/dev/square/invoices/${invoiceId}/pay`));
  await runJobs(page);

  // 6. Check out the package.
  await page.goto(`/bookings/${bookingId}?tab=equipment`);
  await page.getByRole('main').getByRole('link', { name: 'Check out' }).first().click();
  await expect(page.getByRole('spinbutton', { name: 'Headphones' })).toHaveValue('50');
  await page
    .getByRole('group', { name: 'Transmitters' })
    .getByRole('button', { disabled: false })
    .first()
    .click();
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Complete check-out' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Out');

  // 7. Check in with 3 headphones missing; a $180 loss charge is proposed.
  await page.getByRole('main').getByRole('link', { name: 'Check in' }).first().click();
  await page.getByRole('spinbutton', { name: 'Headphones returned' }).fill('47');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('list', { name: 'Check-in summary' })).toContainText('3 missing');
  await expect(page.getByText('A $180.00 loss charge will be proposed')).toBeVisible();
  await page.getByRole('button', { name: 'Complete check-in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Returned');

  // 8. Approve the charge; it is collected from the card saved with the deposit.
  await page.goto(`/bookings/${bookingId}?tab=payments`);
  const charges = page.getByRole('list', { name: 'Charges' });
  await expect(charges).toContainText('proposed');
  await charges.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve loss charge' });
  await approve.getByRole('button', { name: 'Approve charge' }).click();
  await expect(approve).toBeHidden();
  await runJobs(page);
  await page.reload();
  await expect(charges).toContainText('charged');
  await expect(money).toContainText('Paid$555.00');
  await expect(money).toContainText('Balance$0.00');

  // 9. Nothing blocks closing any more.
  await expect(page.getByRole('list', { name: 'Close blockers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close booking' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close booking' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed');

  // Put the inventory back for other tests: the missing headphones turn up.
  await page.goto(`/bookings/${bookingId}?tab=equipment`);
  await page.getByRole('button', { name: 'Record found items' }).click();
  const found = page.getByRole('dialog');
  const more = found.getByRole('button', { name: 'Increase headphones found' });
  await more.click();
  await more.click();
  await expect(found.getByRole('spinbutton', { name: 'Headphones found' })).toHaveValue('3');
  await found.getByRole('button', { name: 'Record found' }).click();
  await expect(found).toBeHidden();
  await expect(page.getByRole('list', { name: 'Found items' })).toContainText('3 headphones');
});
