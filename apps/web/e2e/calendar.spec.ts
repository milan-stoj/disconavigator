import { expect, test, type APIRequestContext } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 7);
const pad = (n: number) => String(n).padStart(2, '0');

async function json<T>(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as T;
}

test('an accepted rental shows as a tentative hold and DJs can be marked off', async ({ page }) => {
  const id = uid();
  // A random far-future Saturday keeps runs that share a database apart.
  const base = new Date(
    Date.UTC(2097, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 20)),
  );
  base.setUTCDate(base.getUTCDate() + ((6 - base.getUTCDay() + 7) % 7));
  const date = base.toISOString().slice(0, 10);
  const nextDay = new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10);

  const api = page.request;
  const types = await json<{ id: string; name: string }[]>(await api.get('/api/equipment'));
  const hp = types.find((t) => t.name === 'Headphones')!.id;
  const org = await json<{ id: string }>(
    await api.post('/api/organizations', { data: { name: `Cal Bar ${id}`, type: 'bar' } }),
  );
  const contact = await json<{ id: string }>(
    await api.post('/api/contacts', {
      data: { name: `Cal ${id}`, email: `cal-${id}@example.test`, organizationId: org.id },
    }),
  );
  const opp = await json<{ id: string }>(
    await api.post('/api/opportunities', {
      data: {
        title: `Calendar rental ${id}`,
        stage: 'contacted',
        organizationId: org.id,
        contactId: contact.id,
      },
    }),
  );
  const quote = await json<{ id: string }>(
    await api.post('/api/quotes', {
      data: {
        opportunityId: opp.id,
        bookingType: 'equipment_rental',
        pricingTerm: 'flat_fee',
        startDate: date,
        endDate: date,
        insideServiceArea: true,
        lines: [{ kind: 'custom', description: 'Headphones', quantity: 1, unitPriceCents: 20_000 }],
        requirements: { [hp]: 40 },
        staffRequired: 0,
      },
    }),
  );
  const sent = await json<{ current: { publicUrl: string } }>(
    await api.post(`/api/quotes/${quote.id}/send`),
  );
  const token = new URL(sent.current.publicUrl).pathname.split('/').pop();
  await json(
    await api.post(`/api/public/quotes/${token}/accept`, {
      data: { fullName: `Cal ${id}`, agreeToTerms: true },
    }),
  );

  await page.goto(`/calendar?view=month&date=${date}`);
  const cell = page.locator(`[role="gridcell"][data-date="${date}"]`);
  await expect(cell.locator('[data-strength="tentative"]')).toContainText(`Calendar rental ${id}`);
  // The one-day turnaround buffer holds the equipment the next day too.
  await expect(
    page.locator(`[role="gridcell"][data-date="${nextDay}"] [data-strength="tentative"]`),
  ).toContainText(`Calendar rental ${id}`);

  await cell.click();
  const details = page.getByRole('region', { name: 'Day details' });
  await expect(
    details.getByRole('list', { name: 'Bookings on this day' }).getByText('Tentative'),
  ).toBeVisible();

  const djs = details.getByRole('list', { name: 'DJ availability' }).getByRole('switch');
  await expect(djs.first()).toBeChecked();
  await djs.first().click();
  await expect(djs.first()).not.toBeChecked();
  // Other tests may add DJs to the shared database, so count rather than assume two.
  const others = (await djs.count()) - 1;
  await expect(
    details.getByText(`${others} available of ${others} · 0 committed`, { exact: true }),
  ).toBeVisible();
  await djs.first().click();
  await expect(djs.first()).toBeChecked();

  // Keyboard: the selected day is focusable and arrows move the selection.
  await cell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`[role="gridcell"][data-date="${nextDay}"]`)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`date=${nextDay}`));
});

test('the dashboard lists an overbooked date', async ({ page }) => {
  const id = uid();
  const api = page.request;
  const types = await json<{ id: string; name: string }[]>(await api.get('/api/equipment'));
  const hp = types.find((t) => t.name === 'Headphones')!.id;
  const soon = new Date();
  soon.setDate(soon.getDate() + 20 + Math.floor(Math.random() * 40));
  const date = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`;

  for (const [name, headphones] of [
    [`Overbook A ${id}`, 80],
    [`Overbook B ${id}`, 50],
  ] as const) {
    const org = await json<{ id: string }>(
      await api.post('/api/organizations', { data: { name, type: 'bar' } }),
    );
    const contact = await json<{ id: string }>(
      await api.post('/api/contacts', {
        data: { name, email: `${uid()}@example.test`, organizationId: org.id },
      }),
    );
    const opp = await json<{ id: string }>(
      await api.post('/api/opportunities', {
        data: { title: name, stage: 'contacted', organizationId: org.id, contactId: contact.id },
      }),
    );
    const quote = await json<{ id: string }>(
      await api.post('/api/quotes', {
        data: {
          opportunityId: opp.id,
          bookingType: 'full_service',
          pricingTerm: 'flat_fee',
          startDate: date,
          endDate: date,
          insideServiceArea: true,
          lines: [{ kind: 'custom', description: 'DJ night', quantity: 1, unitPriceCents: 50_000 }],
          requirements: { [hp]: headphones },
          staffRequired: 1,
        },
      }),
    );
    const sent = await json<{ current: { publicUrl: string } }>(
      await api.post(`/api/quotes/${quote.id}/send`),
    );
    const token = new URL(sent.current.publicUrl).pathname.split('/').pop();
    await json(
      await api.post(`/api/public/quotes/${token}/accept`, {
        data: { fullName: name, agreeToTerms: true },
      }),
    );
  }

  await page.goto('/');
  const rows = page
    .getByRole('list', { name: 'Capacity conflicts' })
    .getByRole('listitem')
    .filter({ hasText: `Overbook A ${id}` });
  // The event night (fleet split) plus the turnaround day after it, when the gear is still out.
  await expect(rows).toHaveCount(2);
  const item = rows.filter({ hasText: 'Fleet split' });
  await expect(item).toContainText(`Overbook B ${id}`);
  await expect(item).toContainText(/Headphones short \d+/);
  await item.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?view=day&date=${date}`));
  await expect(page.getByRole('region', { name: 'Day details' })).toContainText(
    'Capacity conflict',
  );
});
