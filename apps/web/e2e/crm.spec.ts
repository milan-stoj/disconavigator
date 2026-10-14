import { expect, test, type Page } from '@playwright/test';

const column = (page: Page, stage: string) =>
  page.getByRole('region', { name: new RegExp(`^${stage} \\d+$`) });

// Names are unique per run so repeated runs against one database stay independent.
const uid = () => Math.random().toString(36).slice(2, 7);

test('adds an organization with a contact and logs a call', async ({ page }) => {
  const id = uid();
  const orgName = `Brew City Taproom ${id}`;
  const person = `Jordan Lee ${id}`;
  await page.goto('/organizations');
  await page.getByRole('button', { name: 'New organization' }).click();
  const create = page.getByRole('dialog', { name: 'New organization' });
  await create.getByLabel('Name').fill(orgName);
  await create.getByLabel('City').fill('Milwaukee');
  await create.getByLabel('Competitor notes').fill('Quoted $900 by Quiet Events');
  await create.getByRole('button', { name: 'Add organization' }).click();

  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await expect(page.getByText('Quoted $900 by Quiet Events')).toBeVisible();

  await page.getByRole('button', { name: 'Add contact' }).click();
  const contact = page.getByRole('dialog', { name: 'New contact' });
  await contact.getByLabel('Name').fill(person);
  await contact.getByLabel('Email').fill(`jordan-${id}@brewcity.test`);
  await contact.getByRole('button', { name: 'Add contact' }).click();
  await expect(contact).toBeHidden();
  await expect(page.getByRole('link', { name: person })).toBeVisible();

  await page.getByRole('button', { name: 'Log activity' }).click();
  const log = page.getByRole('dialog', { name: 'Log activity' });
  await log.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Call' }).click();
  await log.getByLabel('What happened?').fill('Wants a Friday in July');
  await log.getByRole('button', { name: 'Save' }).click();
  await expect(log).toBeHidden();
  const timeline = page.getByRole('list', { name: 'Activity timeline' });
  await expect(timeline.getByRole('listitem').first()).toContainText('Wants a Friday in July');

  // A second contact with the same email triggers the duplicate warning.
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New contact' }).click();
  const dup = page.getByRole('dialog', { name: 'New contact' });
  await dup.getByLabel('Name').fill('J. Lee');
  await dup.getByLabel('Email').fill(`Jordan-${id}@BrewCity.test`);
  await dup.getByRole('button', { name: 'Add contact' }).click();
  const warning = page.getByRole('alertdialog', { name: 'This contact may already exist' });
  await warning.getByRole('link', { name: `Open ${person}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: person })).toBeVisible();
});

test('moves opportunities across the pipeline and marks one lost', async ({ page }) => {
  const id = uid();
  const summer = `Lounge summer night ${id}`;
  const holiday = `Lounge holiday party ${id}`;
  const org = await (
    await page.request.post('/api/organizations', {
      data: { name: `Lakefront Lounge ${id}`, type: 'bar', city: 'Madison' },
    })
  ).json();
  for (const title of [summer, holiday]) {
    const res = await page.request.post('/api/opportunities', {
      data: { title, organizationId: org.id, stage: 'contacted', estimatedValueCents: 80000 },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/pipeline');
  const contacted = column(page, 'Contacted');
  await expect(contacted.getByRole('link', { name: summer })).toBeVisible();
  await expect(contacted.getByRole('link', { name: holiday })).toBeVisible();

  // Keyboard: pick up with space, arrow right one column, drop with space.
  const grip = page.getByRole('button', { name: `Move ${summer}` });
  await grip.focus();
  await page.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('status').filter({ hasText: 'is over Quote Requested' }),
  ).toBeAttached();
  await page.keyboard.press('Space');
  const requested = column(page, 'Quote Requested');
  await expect(requested.getByRole('link', { name: summer })).toBeVisible();
  await expect(page.getByText(`${summer} moved to Quote Requested`)).toBeVisible();

  // Mouse: drag the other card back to New.
  const handle = page.getByRole('button', { name: `Move ${holiday}` });
  const target = await column(page, 'New').boundingBox();
  const start = await handle.boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(column(page, 'New').getByRole('link', { name: holiday })).toBeVisible();

  // Lost needs a reason.
  await page.getByRole('button', { name: `Actions for ${summer}` }).click();
  await page.getByRole('menuitem', { name: 'Lost' }).click();
  const lost = page.getByRole('dialog', { name: `Mark ${summer} as lost` });
  await lost.getByRole('button', { name: 'Mark lost' }).click();
  await expect(lost.getByText('Choose a loss reason')).toBeVisible();
  await lost.getByRole('radio', { name: 'Date unavailable (capacity)' }).check();
  await lost.getByRole('button', { name: 'Mark lost' }).click();
  await expect(lost).toBeHidden();
  await expect(column(page, 'Lost').getByRole('link', { name: summer })).toBeVisible();

  await column(page, 'Lost').getByRole('link', { name: summer }).click();
  await expect(page.getByText('Date unavailable (capacity)')).toBeVisible();
  const history = page.getByRole('list', { name: 'Activity timeline' });
  await expect(history.getByText('Quote Requested → Lost')).toBeVisible();
  await expect(history.getByText('Contacted → Quote Requested')).toBeVisible();
});
