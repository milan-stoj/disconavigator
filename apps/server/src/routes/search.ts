import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { booking, contact, opportunity, organization, quote } from '../db/schema.js';
import { containsText } from '../lib/like.js';
import { parse } from '../lib/validation.js';
import type { AppDeps } from '../app.js';

export interface SearchResult {
  kind: 'organization' | 'contact' | 'opportunity' | 'quote' | 'booking';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

const querySchema = z.object({ q: z.string().trim().max(100).default('') });
const PER_KIND = 5;

export async function searchRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/api/search', async (req): Promise<SearchResult[]> => {
    const { tenant } = requireAuth(req);
    const { q } = parse(querySchema, req.query);
    if (q.length < 2) return [];
    const ilike = (col: Parameters<typeof containsText>[0]) => containsText(col, q);
    const numberMatch = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;

    const orgs = db
      .select({ id: organization.id, name: organization.name, city: organization.city })
      .from(organization)
      .where(
        and(
          eq(organization.tenantId, tenant.id),
          isNull(organization.archivedAt),
          ilike(organization.name),
        ),
      )
      .limit(PER_KIND)
      .all();
    const contacts = db
      .select({ id: contact.id, name: contact.name, email: contact.email })
      .from(contact)
      .where(
        and(
          eq(contact.tenantId, tenant.id),
          isNull(contact.archivedAt),
          or(ilike(contact.name), ilike(contact.email), ilike(contact.phone)),
        ),
      )
      .limit(PER_KIND)
      .all();
    const opps = db
      .select({ id: opportunity.id, title: opportunity.title, stage: opportunity.stage })
      .from(opportunity)
      .where(and(eq(opportunity.tenantId, tenant.id), ilike(opportunity.title)))
      .orderBy(desc(opportunity.updatedAt))
      .limit(PER_KIND)
      .all();
    const quotes = db
      .select({
        id: quote.id,
        number: quote.number,
        status: quote.status,
        title: opportunity.title,
      })
      .from(quote)
      .innerJoin(opportunity, eq(opportunity.id, quote.opportunityId))
      .where(
        and(
          eq(quote.tenantId, tenant.id),
          numberMatch !== null
            ? or(eq(quote.number, numberMatch), ilike(opportunity.title))
            : ilike(opportunity.title),
        ),
      )
      .orderBy(desc(quote.number))
      .limit(PER_KIND)
      .all();
    const bookings = db
      .select({
        id: booking.id,
        number: booking.number,
        title: booking.title,
        startDate: booking.startDate,
      })
      .from(booking)
      .where(
        and(
          eq(booking.tenantId, tenant.id),
          numberMatch !== null
            ? or(eq(booking.number, numberMatch), ilike(booking.title))
            : ilike(booking.title),
        ),
      )
      .orderBy(desc(booking.startDate))
      .limit(PER_KIND)
      .all();

    return [
      ...orgs.map((o) => ({
        kind: 'organization' as const,
        id: o.id,
        title: o.name,
        subtitle: o.city,
        url: `/organizations/${o.id}`,
      })),
      ...contacts.map((c) => ({
        kind: 'contact' as const,
        id: c.id,
        title: c.name,
        subtitle: c.email,
        url: `/contacts/${c.id}`,
      })),
      ...opps.map((o) => ({
        kind: 'opportunity' as const,
        id: o.id,
        title: o.title,
        subtitle: o.stage,
        url: `/pipeline/${o.id}`,
      })),
      ...quotes.map((x) => ({
        kind: 'quote' as const,
        id: x.id,
        title: `Quote #${x.number}`,
        subtitle: x.title,
        url: `/quotes/${x.id}`,
      })),
      ...bookings.map((b) => ({
        kind: 'booking' as const,
        id: b.id,
        title: `#${b.number} ${b.title}`,
        subtitle: b.startDate,
        url: `/bookings/${b.id}`,
      })),
    ];
  });
}
