import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Saved browser state for a signed-in kali (created by auth.setup.ts). */
export const ADMIN_STATE = path.join(import.meta.dirname, '.auth', 'admin.json');

export const ADMIN = { username: 'kali', password: 'e2e-password-123' };

export async function signIn(page: Page, { username, password } = ADMIN) {
  await page.goto('/sign-in');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

export const uid = () => Math.random().toString(36).slice(2, 7);
/** A random far-future date so bookings from other tests never compete for equipment. */
export const randomDate = () => {
  const year = 2090 + Math.floor(Math.random() * 8);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 27);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
/** Contacts are de-duplicated on phone, so every test needs its own number. */
export const randomPhone = () =>
  `414-555-${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function json<T>(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as T;
}

/** Opportunity → quote → send → customer accepts, all through the API. Returns the booking id. */
export async function acceptedBooking(
  page: Page,
  id: string,
  quote: Record<string, unknown> & { bookingType: 'equipment_rental' | 'full_service' },
) {
  const api = page.request;
  const phone = randomPhone();
  const types = await json<{ id: string; name: string }[]>(await api.get('/api/equipment'));
  const typeId = (n: string) => types.find((t) => t.name === n)!.id;
  const org = await json<{ id: string }>(
    await api.post('/api/organizations', { data: { name: `Bar ${id}`, type: 'bar' } }),
  );
  const contact = await json<{ id: string }>(
    await api.post('/api/contacts', {
      data: {
        name: `Sam ${id}`,
        email: `sam-${id}@example.test`,
        phone,
        organizationId: org.id,
      },
    }),
  );
  const opp = await json<{ id: string }>(
    await api.post('/api/opportunities', {
      data: {
        title: `Silent disco ${id}`,
        stage: 'contacted',
        organizationId: org.id,
        contactId: contact.id,
      },
    }),
  );
  const date = randomDate();
  const isRental = quote.bookingType === 'equipment_rental';
  const created = await json<{ id: string }>(
    await api.post('/api/quotes', {
      data: {
        opportunityId: opp.id,
        pricingTerm: 'flat_fee',
        startDate: date,
        endDate: isRental ? addDays(date, 2) : date,
        insideServiceArea: true,
        lines: [{ kind: 'custom', description: 'Package', quantity: 1, unitPriceCents: 50_000 }],
        requirements: { [typeId('Headphones')]: 10, [typeId('Transmitters')]: 1 },
        staffRequired: isRental ? 0 : 1,
        ...quote,
      },
    }),
  );
  const sent = await json<{ current: { publicUrl: string } }>(
    await api.post(`/api/quotes/${created.id}/send`),
  );
  const token = sent.current.publicUrl.split('/q/')[1];
  const accepted = await json<{ bookingIds: string[] }>(
    await api.post(`/api/public/quotes/${token}/accept`, {
      data: { fullName: `Sam ${id}`, agreeToTerms: true },
    }),
  );
  return { bookingId: accepted.bookingIds[0]!, phone };
}
