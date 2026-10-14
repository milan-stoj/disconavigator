import { expect, test, type Page } from '@playwright/test';
import { json, uid } from './helpers';

const runJobs = async (page: Page) => json(await page.request.post('/api/dev/jobs/run'));

/** The first Friday of a random far-future month, so DJs are free on every date of the series. */
function firstFriday() {
  const d = new Date(
    Date.UTC(2090 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 10), 1),
  );
  d.setUTCDate(1 + ((5 - d.getUTCDay() + 7) % 7));
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

test.afterEach(async ({ page }) => {
  // Other specs expect Square to be disconnected.
  await page.request.delete('/api/settings/square');
});

test('full-service door-split series for a bar, settled and invoiced', async ({
  page,
  browser,
}) => {
  const id = uid();
  const start = firstFriday();
  const until = new Date(start);
  until.setUTCMonth(until.getUTCMonth() + 2, 28);
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
  const org = await json<{ id: string }>(
    await page.request.post('/api/organizations', {
      data: { name: `Cactus Club ${id}`, type: 'bar' },
    }),
  );
  const contact = await json<{ id: string }>(
    await page.request.post('/api/contacts', {
      data: { name: `Dana ${id}`, email: `dana-${id}@example.test`, organizationId: org.id },
    }),
  );
  const opp = await json<{ id: string; title: string }>(
    await page.request.post('/api/opportunities', {
      data: {
        title: `First Fridays ${id}`,
        stage: 'contacted',
        organizationId: org.id,
        contactId: contact.id,
        serviceInterest: 'full_service',
      },
    }),
  );

  // 1. Build a monthly series on a 40% door split.
  await page.goto(`/pipeline/${opp.id}`);
  await page.getByRole('link', { name: 'New quote' }).click();
  await expect(page.getByRole('radio', { name: /Full-service event/ })).toBeChecked();
  await page.getByLabel('Event date').fill(iso(start));
  await page.getByLabel('Start time').fill('21:00');
  await page.getByLabel('End time').fill('23:30');
  await page.getByLabel('Venue / location').fill(`Cactus Club ${id}`);
  await page.getByRole('switch', { name: 'Recurring series' }).click();
  await expect(page.getByLabel('Repeats')).toContainText('The first Friday of each month');
  await page.getByLabel('Repeat until').fill(iso(until));
  await expect(page.getByText('3 dates')).toBeVisible();
  await page.getByLabel('Pricing terms').click();
  await page.getByRole('option', { name: 'Door split', exact: true }).click();
  await page.getByLabel('Door split %').fill('40');
  await page.getByRole('spinbutton', { name: 'Headphones' }).fill('60');
  await page.getByRole('spinbutton', { name: 'Transmitters' }).fill('1');
  const totals = page.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('40% of door revenue');
  await expect(totals).toContainText('No holding deposit');
  await page.getByRole('button', { name: 'Create quote' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Quote Q-\d+/ })).toBeVisible();
  const quoteUrl = page.url();
  await page.getByRole('button', { name: 'Send quote' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sent');

  // 2. The bar accepts; every date is confirmed straight away, with no deposit or invoice.
  const quote = await json<{ current: { publicUrl: string } }>(
    await page.request.get(`/api/quotes/${quoteUrl.split('/quotes/')[1]}`),
  );
  const customer = await browser.newContext({ storageState: undefined });
  const view = await customer.newPage();
  await view.goto(new URL(quote.current.publicUrl).pathname);
  await expect(view.getByRole('group', { name: 'Quote totals' })).not.toContainText(
    'Holding deposit',
  );
  await view.getByRole('checkbox', { name: /I agree to the/ }).check();
  await view.getByLabel('Type your full name to sign').fill(`Dana ${id}`);
  await view.getByRole('button', { name: 'Accept quote' }).click();
  await expect(view.getByRole('status')).toContainText('Quote accepted');
  await customer.close();
  await runJobs(page);

  await page.goto(quoteUrl);
  const bookings = page.getByRole('list', { name: 'Bookings' });
  await expect(bookings.getByRole('listitem')).toHaveCount(3);
  for (const item of await bookings.getByRole('listitem').all()) {
    await expect(item).toContainText('Confirmed');
  }
  await bookings.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/bookings\/[^/?]+/);
  const bookingId = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/bookings/${bookingId}?tab=payments`);
  const money = page.getByRole('region', { name: 'Money summary' });
  await expect(money).toContainText('OwedAfter settlement');
  await expect(page.getByText('No invoices yet.')).toBeVisible();
  await expect(page.getByText('No payments yet.')).toBeVisible();

  // 3. Settle the first night: $1,000 at the door, so the bar owes $400.
  await page.getByRole('button', { name: 'Record settlement' }).click();
  const settle = page.getByRole('dialog');
  await settle.getByLabel('Door revenue').fill('1000');
  await expect(settle.getByText('Amount owed: $400.00')).toBeVisible();
  await settle.getByRole('button', { name: 'Record settlement' }).click();
  await expect(settle).toBeHidden();
  await expect(money).toContainText('Owed$400.00');

  // 4. The settlement invoice is created in Square.
  await runJobs(page);
  await page.reload();
  const invoices = page.getByRole('table', { name: 'Invoices' });
  const row = invoices.getByRole('row', { name: /settlement/i });
  await expect(row).toContainText('$400.00');
  await expect(row).toContainText(/published/i);
  await expect(row.getByRole('link')).toHaveAttribute('href', /^https?:\/\//);

  // The other dates are still waiting for their own settlement.
  const series = await json<{ series: { id: string }[] }>(
    await page.request.get(`/api/bookings/${bookingId}`),
  );
  for (const other of series.series.filter((s) => s.id !== bookingId)) {
    const b = await json<{ invoices: unknown[]; status: string }>(
      await page.request.get(`/api/bookings/${other.id}`),
    );
    expect(b).toMatchObject({ status: 'confirmed', invoices: [] });
  }
});
