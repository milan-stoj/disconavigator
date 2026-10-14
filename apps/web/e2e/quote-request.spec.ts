import { devices, expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 7);

test('a visitor requests a quote on mobile and staff see it as new', async ({ browser, page }) => {
  const id = uid();
  const name = `Riley Park ${id}`;
  const visitor = await browser.newContext({ ...devices['Pixel 7'], storageState: undefined });
  const form = await visitor.newPage();
  await form.goto('/request/undercover-dance-party');
  await expect(form.getByText('Undercover Dance Party')).toBeVisible();
  await expect(form.getByRole('heading', { name: 'Request a silent disco quote' })).toBeVisible();

  // Required fields are enforced before anything is sent.
  await form.getByRole('button', { name: 'Request a quote' }).click();
  await expect(form.getByText('Choose a service')).toBeVisible();
  await expect(form.getByText('Enter a valid email')).toBeVisible();

  await form.getByRole('radio', { name: /Rent the headphones/ }).check();
  await form.getByLabel('Event date').fill('2099-08-14');
  await form.getByLabel('Expected guests').fill('120');
  await form.getByLabel('Event location').fill('Olbrich Park, Madison');
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Organization (optional)').fill(`Eastside Block Party ${id}`);
  await form.getByLabel('Email').fill(`riley-${id}@example.test`);
  await form.getByLabel('Anything else? (optional)').fill('Neighborhood block party');
  await form.getByRole('button', { name: 'Request a quote' }).click();
  await expect(form.getByRole('heading', { name: 'Thanks, we got your request' })).toBeVisible();
  await expect(form.getByText(`riley-${id}@example.test`)).toBeVisible();
  await visitor.close();

  await page.goto('/');
  const pipelineLink = page.getByRole('link', { name: /^Pipeline \(\d+ new quote requests?\)$/ });
  await expect(pipelineLink).toBeVisible();
  const requests = page.getByRole('list', { name: 'New quote requests' });
  await requests.getByRole('link', { name: new RegExp(name) }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(`Eastside Block Party ${id}`) }),
  ).toBeVisible();
  await expect(page.getByText('Website quote request')).toBeVisible();
  await expect(page.getByText('Olbrich Park, Madison')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Activity timeline' }).getByText('Neighborhood block party'),
  ).toBeVisible();

  await page.goto('/');
  await expect(requests.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
});
