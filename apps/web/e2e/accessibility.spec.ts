import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { acceptedBooking, json, uid } from './helpers';

const THEMES = ['light', 'dark'] as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Serious and critical axe violations on the current page, formatted for the failure message. */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')} — ${n.failureSummary}`).join('\n'),
    );
}

async function audit(page: Page, theme: (typeof THEMES)[number], paths: string[]) {
  await page.addInitScript((t) => localStorage.setItem('disco-theme', t), theme);
  const found: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // Let loading skeletons settle so axe sees the real content.
    await page.waitForLoadState('networkidle');
    for (const v of await seriousViolations(page)) found.push(`${path} [${theme}]\n  ${v}`);
  }
  expect(found, found.join('\n\n')).toEqual([]);
}

let data: {
  bookingId: string;
  quoteId: string;
  publicPath: string;
  opportunityId: string;
  organizationId: string;
  contactId: string;
};

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const id = uid();
  const { bookingId } = await acceptedBooking(page, id, { bookingType: 'equipment_rental' });
  const b = await json<{
    quoteId: string;
    organization: { id: string };
    contact: { id: string };
    opportunityId: string;
  }>(await page.request.get(`/api/bookings/${bookingId}`));
  const q = await json<{ current: { publicUrl: string } }>(
    await page.request.get(`/api/quotes/${b.quoteId}`),
  );
  data = {
    bookingId,
    quoteId: b.quoteId,
    publicPath: new URL(q.current.publicUrl).pathname,
    opportunityId: b.opportunityId,
    organizationId: b.organization.id,
    contactId: b.contact.id,
  };
  await page.close();
});

for (const theme of THEMES) {
  test(`staff pages have no serious accessibility issues in ${theme} mode`, async ({ page }) => {
    test.slow();
    await audit(page, theme, [
      '/',
      '/pipeline',
      `/pipeline/${data.opportunityId}`,
      '/organizations',
      `/organizations/${data.organizationId}`,
      '/contacts',
      `/contacts/${data.contactId}`,
      '/quotes',
      `/quotes/${data.quoteId}`,
      `/quotes/new?opportunityId=${data.opportunityId}`,
      '/bookings',
      `/bookings/${data.bookingId}`,
      `/bookings/${data.bookingId}?tab=payments`,
      '/calendar',
      '/inventory',
      '/money-owed',
      '/settings',
    ]);
  });

  test(`public pages have no serious accessibility issues in ${theme} mode`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await audit(page, theme, ['/sign-in', '/request/undercover-dance-party', data.publicPath]);
    await context.close();
  });
}
