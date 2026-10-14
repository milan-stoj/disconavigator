import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 7);

async function json<T>(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as T;
}

/** Creates a bar with a contact and an opportunity through the API. */
async function setupOpportunity(
  page: Page,
  opts: { id: string; serviceInterest: 'equipment_rental' | 'full_service' },
) {
  const api = page.request;
  const org = await json<{ id: string }>(
    await api.post('/api/organizations', { data: { name: `Bar ${opts.id}`, type: 'bar' } }),
  );
  const contact = await json<{ id: string }>(
    await api.post('/api/contacts', {
      data: {
        name: `Sam ${opts.id}`,
        email: `sam-${opts.id}@example.test`,
        organizationId: org.id,
      },
    }),
  );
  return json<{ id: string; title: string }>(
    await api.post('/api/opportunities', {
      data: {
        title: `Silent disco ${opts.id}`,
        stage: 'contacted',
        organizationId: org.id,
        contactId: contact.id,
        serviceInterest: opts.serviceInterest,
      },
    }),
  );
}

async function createPackage(page: Page, name: string) {
  const types = await json<{ id: string; name: string }[]>(
    await page.request.get('/api/equipment'),
  );
  const id = (n: string) => types.find((t) => t.name === n)!.id;
  return json<{ id: string }>(
    await page.request.post('/api/packages', {
      data: {
        name,
        priceCents: 30_000,
        includedDays: 3,
        extraDayPriceCents: 7_500,
        items: [
          { equipmentTypeId: id('Headphones'), quantity: 50 },
          { equipmentTypeId: id('Transmitters'), quantity: 1 },
        ],
      },
    }),
  );
}

test('build and send an equipment rental quote', async ({ page }) => {
  const id = uid();
  const pkg = `Party 50 ${id}`;
  await createPackage(page, pkg);
  const opp = await setupOpportunity(page, { id, serviceInterest: 'equipment_rental' });

  await page.goto(`/pipeline/${opp.id}`);
  await page.getByRole('link', { name: 'New quote' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Equipment rental/ })).toBeChecked();
  // Split terms are never offered for rentals.
  await expect(page.getByLabel('Pricing terms')).toHaveCount(0);

  await page.getByLabel('Pickup date').fill('2099-03-06');
  await page.getByLabel('Return date').fill('2099-03-08');
  await page.getByLabel('Delivery or pickup location').fill('Lake Geneva, WI');
  await page.getByRole('combobox', { name: 'Add a package' }).click();
  await page.getByRole('option', { name: new RegExp(pkg) }).click();
  const lines = page.getByRole('list', { name: 'Line items' });
  await expect(lines.getByRole('listitem')).toHaveCount(1);

  await page.getByRole('switch', { name: 'Inside the service area' }).click();
  await expect(lines.getByRole('listitem')).toHaveCount(2);
  await expect(lines.getByLabel('Delivery fee')).toHaveValue('Delivery outside service area');

  const totals = page.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('Total$375.00');
  await expect(totals).toContainText('Holding deposit (20%)$75.00');
  await expect(totals).toContainText('Balance$300.00');
  await expect(page.getByText('Equipment and DJs are available')).toBeVisible();

  await page.getByRole('button', { name: 'Create quote' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Quote Q-\d+/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Draft');
  await page.getByRole('button', { name: 'Send quote' }).click();
  await expect(page.getByText(`sent to sam-${id}@example.test`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sent');
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend' })).toBeVisible();

  await page.getByRole('link', { name: opp.title }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Quoted');
  await expect(page.getByRole('list', { name: 'Quotes' })).toContainText('Sent');
});

test('build and send a full-service series quote with guarantee plus split', async ({ page }) => {
  const id = uid();
  const opp = await setupOpportunity(page, { id, serviceInterest: 'full_service' });

  await page.goto('/quotes');
  await page.getByRole('button', { name: 'New quote' }).click();
  await page.getByRole('dialog').getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(opp.title) }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('radio', { name: /Full-service event/ })).toBeChecked();
  await page.getByLabel('Event date').fill('2099-01-02');
  await page.getByLabel('Start time').fill('21:00');
  await page.getByLabel('End time').fill('23:30');
  await page.getByLabel('Venue / location').fill(`Bar ${id}`);

  await page.getByRole('switch', { name: 'Recurring series' }).click();
  await expect(page.getByLabel('Repeats')).toContainText('The first Friday of each month');
  await page.getByLabel('Repeat until').fill('2099-06-30');
  await expect(page.getByText('6 dates')).toBeVisible();

  await page.getByLabel('Pricing terms').click();
  await page.getByRole('option', { name: 'Guarantee + split' }).click();
  await page.getByLabel('Door split %').fill('40');
  await page.getByLabel('Guarantee', { exact: true }).fill('500');
  await page.getByRole('spinbutton', { name: 'Headphones' }).fill('80');
  await page.getByRole('spinbutton', { name: 'Transmitters' }).fill('3');

  const totals = page.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('Guaranteed minimum$500.00');
  await expect(totals).toContainText('40% of door revenue');
  await expect(totals).toContainText('greater of $500.00 and 40% of the door');
  await expect(totals).toContainText('No holding deposit');
  await expect(
    page.getByRole('list', { name: 'Occurrence dates' }).getByRole('listitem'),
  ).toHaveCount(6);

  await page.getByRole('button', { name: 'Create quote' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Quote Q-\d+/ })).toBeVisible();
  await expect(page.getByText(/6 events:/)).toBeVisible();
  await page.getByRole('button', { name: 'Send quote' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sent');

  // Editing a sent quote warns that a new revision replaces the customer's link.
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByText('Saving creates revision 2')).toBeVisible();
  await page.getByLabel('Door split %').fill('45');
  await page.getByRole('button', { name: 'Save quote' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Draft');
  await expect(page.getByRole('list', { name: 'Revisions' })).toContainText('link replaced');
});

/** Creates and sends a quote through the API; returns its public path (/q/…). */
async function sendQuote(page: Page, body: Record<string, unknown>) {
  const quote = await json<{ id: string }>(await page.request.post('/api/quotes', { data: body }));
  const sent = await json<{ current: { publicUrl: string } }>(
    await page.request.post(`/api/quotes/${quote.id}/send`),
  );
  return { id: quote.id, path: new URL(sent.current.publicUrl).pathname };
}

test('a customer accepts a rental quote on the public page', async ({ page, browser }) => {
  const id = uid();
  const pkg = await createPackage(page, `Party 50 ${id}`);
  const opp = await setupOpportunity(page, { id, serviceInterest: 'equipment_rental' });
  const { id: quoteId, path } = await sendQuote(page, {
    opportunityId: opp.id,
    bookingType: 'equipment_rental',
    pricingTerm: 'flat_fee',
    startDate: '2099-04-03',
    endDate: '2099-04-05',
    location: 'Bay View, Milwaukee',
    insideServiceArea: true,
    lines: [
      {
        kind: 'package',
        description: 'Party 50',
        quantity: 1,
        unitPriceCents: 100_000,
        packageId: pkg.id,
      },
    ],
  });

  const customer = await browser.newContext({ storageState: undefined });
  const view = await customer.newPage();
  await view.goto(path);
  await expect(view.getByRole('banner')).toContainText('Undercover Dance Party');
  await expect(view.getByRole('heading', { level: 1, name: opp.title })).toBeVisible();
  await expect(view.getByText('Equipment rental', { exact: true })).toBeVisible();
  const totals = view.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('Total$1,000.00');
  await expect(totals).toContainText('Holding deposit (20%)$200.00');
  await expect(totals).toContainText('Balance$800.00');
  await expect(view.getByRole('heading', { name: 'Rental terms' })).toBeVisible();

  // Both the terms checkbox and a typed name are required.
  await view.getByRole('button', { name: 'Accept quote' }).click();
  await expect(view.getByText('You must agree to the terms')).toBeVisible();
  await view.getByRole('checkbox', { name: 'I agree to the rental terms above' }).check();
  await view.getByLabel('Type your full name to sign').fill(`Sam ${id}`);
  await view.getByRole('button', { name: 'Accept quote' }).click();
  await expect(view.getByRole('status')).toContainText('Quote accepted');
  await expect(view.getByText(`Accepted by Sam ${id}`)).toBeVisible();
  await expect(view.getByRole('button', { name: 'Accept quote' })).toHaveCount(0);
  await customer.close();

  await page.goto(`/quotes/${quoteId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Accepted');
  await expect(page.getByRole('list', { name: 'Bookings' })).toContainText('Awaiting deposit');
});

test('a customer declines a full-service quote on the public page', async ({ page, browser }) => {
  const id = uid();
  const opp = await setupOpportunity(page, { id, serviceInterest: 'full_service' });
  const { path } = await sendQuote(page, {
    opportunityId: opp.id,
    bookingType: 'full_service',
    pricingTerm: 'door_split',
    splitBps: 4000,
    startDate: '2099-05-09',
    endDate: '2099-05-09',
    lines: [],
    staffRequired: 1,
  });

  const customer = await browser.newContext({ storageState: undefined });
  const view = await customer.newPage();
  await view.goto(path);
  await expect(view.getByText('Full-service event', { exact: true })).toBeVisible();
  const totals = view.getByRole('group', { name: 'Quote totals' });
  await expect(totals).toContainText('40% of door revenue');
  await expect(totals).toContainText('determined after the event');
  await expect(totals).not.toContainText('Holding deposit');
  await expect(view.getByRole('heading', { name: 'Event terms' })).toBeVisible();

  await view.getByRole('button', { name: 'Decline' }).click();
  await view.getByLabel('Reason (optional)').fill('Going with a DJ we know');
  await view.getByRole('button', { name: 'Decline quote' }).click();
  await expect(view.getByRole('status')).toContainText('Quote declined');
  await customer.close();

  await page.goto(`/pipeline/${opp.id}`);
  await expect(page.getByText('Why was this lost?')).toBeVisible();
});
