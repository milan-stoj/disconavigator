# Design

## Context

Greenfield project: no existing code, specs, or tools are in use (see proposal.md - Why). Constraints that shape the approach:

- Runs on a single Raspberry Pi 5 (ARM64, 4-8 GB RAM) with minimal recurring cost; must be reachable publicly for the quote request form, quote acceptance links, and Square webhooks.
- Stack preferences: React + TypeScript, shadcn/ui, Tailwind CSS, Lucide icons, Node.js backend, SQLite now with a possible move to PostgreSQL.
- One tenant (Undercover Dance Party) today, with a path to multi-tenant SaaS later.
- Tiny scale: one tenant, a few users, tens to hundreds of bookings per year, and a fleet of 100 headphones and 3 transmitters.
- Square is already the business's payment and invoicing tool.

## Goals / Non-Goals

**Goals:**
- A single deployable process with no external services beyond Square, email (SMTP), and backups.
- Tenant scoping enforced in one place so multi-tenancy later is a matter of onboarding, not a rewrite.
- Money and capacity calculations isolated as pure, unit-tested functions.
- A consistent, accessible, responsive dashboard UI built from shadcn/ui primitives and blocks, with light and dark mode.

**Non-Goals:**
- Tenant self-signup, billing for SaaS subscriptions, or per-tenant custom domains.
- Offline-first mobile app; check-in/out is a responsive web page that requires connectivity.
- Barcode/QR scanning of equipment (pooled headphones make counting sufficient for now).
- Automatic geocoding or distance-based delivery pricing.
- Accounting, sales tax reporting, or payroll; Square remains the money system of record.

## Decisions

### 1. Monorepo with three packages
`apps/web` (React SPA), `apps/server` (Node API), and `packages/shared` (Zod schemas, types, and pure domain logic: pricing, deposits, settlement, capacity). pnpm workspaces.
- *Why:* the same validation and calculations run in the browser (live quote totals, capacity warnings) and on the server (authoritative).
- *Alternative:* a single Next.js app. Rejected because a separate SPA plus a lightweight API uses fewer resources on the Pi, has no server rendering to operate, and keeps the API reusable for a future mobile app or integrations.

### 2. Frontend: Vite + React + TypeScript + shadcn/ui
- Vite build, React Router for routing, TanStack Query for server state, React Hook Form + Zod (via `@hookform/resolvers`) for forms, TanStack Table for data tables, Sonner for toasts, `@dnd-kit` for the pipeline board.
- Layout from the shadcn `sidebar` block (collapsible sidebar, header with breadcrumbs, command palette via `Command` for keyboard navigation). Theme provider with light, dark, and system modes using Tailwind's class strategy.
- Date pickers use shadcn `Calendar` (react-day-picker). The capacity calendar is a custom month/week grid composed from shadcn `Card`, `Badge`, `Tooltip`, and `Popover`, because per-day capacity bars are domain-specific. *Alternative:* FullCalendar, which handles events well but not per-day capacity summaries and adds heavy styling overrides.
- Public pages (quote request form, quote acceptance) live in the same SPA under unauthenticated routes with a minimal branded layout.
- Mobile-first layouts for check-out/check-in and the event sheet: large tap targets, numeric steppers, and a single-column flow.

### 3. Backend: Fastify on Node.js LTS
- Fastify with `@fastify/cookie`, `@fastify/rate-limit`, and `@fastify/static` (serves the built SPA). Routes validated with the shared Zod schemas.
- *Alternatives:* Express (older, slower, weaker typing) and Hono (good, but Fastify's plugin ecosystem covers our needs out of the box).

### 4. Database: SQLite via Drizzle ORM
- `better-sqlite3` driver, WAL mode, foreign keys on. Drizzle schema and generated SQL migrations committed to the repo.
- Portability rules for a later PostgreSQL move: text IDs (UUIDv7) generated in the app, integer cents for money, ISO-8601 text for timestamps (UTC), `YYYY-MM-DD` text for calendar dates in the tenant's time zone (America/Chicago), and no SQLite-only SQL in queries.
- *Alternatives:* Prisma (heavier runtime and slower ARM builds) and Kysely (good, but Drizzle gives schema-as-code plus migrations in one tool).

### 5. Tenancy enforced in a data-access layer
Every business table has a non-null `tenant_id`. Route handlers never query tables directly; they call repository functions that take the session's tenant ID and always filter by it. Lookups by ID that miss the tenant return "not found". Tests assert cross-tenant isolation for every repository.
- *Alternative:* a database per tenant. Rejected: simpler backups and migrations with a shared database at this scale; can be revisited for SaaS.

### 6. Authentication: first-party sessions
Username and password with Argon2id hashing (`@node-rs/argon2`, which has ARM64 prebuilt binaries). Server-side sessions table, with an opaque random token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, idle and absolute expiry, and CSRF protection via the same-site cookie plus an `Origin` header check on state-changing requests. Roles: `admin` and `staff`.
- First-run seeding (idempotent) creates the tenant "Undercover Dance Party", user `kali` (admin), equipment types, 100 headphones, and transmitters TX-1 to TX-3. The password comes from the `INITIAL_ADMIN_PASSWORD` environment variable; if it is absent, the first visit shows a one-time setup screen.
- *Alternative:* Better Auth (would also bring organization/multi-tenant plugins). Deferred: the needs today are small, and the session schema can be migrated if SaaS features justify it.

### 7. Domain model

```
tenant --< user
tenant --< organization --< contact
organization/contact --< opportunity --< quote --< quote_revision --< quote_line
quote_revision --1 acceptance
opportunity --< booking (series_id groups recurring occurrences)
booking --< booking_staff >-- staff_member --< staff_unavailability
booking --< equipment_requirement >-- equipment_type --< equipment_unit (serialized)
booking --< checkout_record --< checkout_item
booking --< settlement
booking --< payment (source: square | external) ; booking --< charge (loss/damage)
rental_package --< package_item >-- equipment_type
inventory_adjustment >-- equipment_type
activity (polymorphic: subject_type, subject_id)
tenant_settings (rental deposit %, buffer days, rental balance due days, full-service invoice due offset, delivery fee, terms per booking type, Square config)
job (outbox for retries and scheduled work)
```

Quote revisions are immutable once sent. Edits create a new revision and rotate the public token. Acceptance points at the exact revision.

### 8. Capacity computed on demand
Availability for a date range is calculated from `owned - out_of_service - committed`, where `committed` sums requirements of non-cancelled bookings whose hold window (dispatch to return plus buffer days) covers each date. Full-service one-night events hold from event date to event date plus buffer. At this data size a single query plus in-memory folding per request is fast; no materialized tables to keep consistent.

### 9. Money and pricing logic
Pure functions in `packages/shared`: `quoteTotal`, `holdingDeposit`, `settlementAmount`, `lossCharge`. All amounts are integer cents; percentages are basis points. Rounding: half-up to the cent, applied once per computed amount. `holdingDeposit` returns zero for full-service bookings; `lossCharge` applies only to equipment rentals.

### 9a. Booking type as a first-class discriminator
`booking_type` (`equipment_rental` | `full_service`) is stored on quotes and bookings and drives a policy object in `packages/shared` that controls which pricing terms are allowed, whether a deposit is required, the initial booking status (Awaiting Deposit vs Confirmed), which invoice is created, which terms text is shown, and whether loss charges are proposed. Keeping these rules in one place stops type-specific `if` checks from spreading through the UI and API.
- *Alternative:* separate quote/booking tables per type. Rejected: the types share customers, dates, equipment holds, payments, and calendar logic; only policy differs.

### 10. Square integration
- Official `square` Node SDK. Per-tenant access token (initially a personal access token from the business's own Square developer app) stored encrypted with AES-256-GCM using an app secret from the environment. OAuth is deferred to the SaaS phase.
- Invoice flow: find or create the Square customer, create an Order with the line items, then create and publish an Invoice:
  - **Equipment rental:** a `DEPOSIT` payment request (20%) plus a `BALANCE` request due N days before dispatch, with card-on-file saving enabled so later loss charges can use the Cards/Payments APIs. When no card is stored, a separate loss invoice is sent instead.
  - **Full-service flat fee:** a single payment request for the full total, due at a configurable offset from the event date (default: event date).
  - **Full-service split or guarantee + split:** no invoice at acceptance; a single invoice for the settled amount after the event.
- Sync: webhook endpoint verifies the HMAC-SHA256 signature using the subscription signature key and notification URL; handles invoice and payment events idempotently (keyed by Square event ID). A reconciliation job every 15 minutes polls invoices for open bookings to catch missed webhooks.
- All Square calls go through the `job` outbox with idempotency keys and exponential backoff, so quote acceptance never fails because Square is down.
- *Alternative:* recording payments manually only. Rejected because chasing payments is a stated pain point.

### 11. Background work in-process
A small scheduler inside the server process polls the `job` table (invoice creation retries, reconciliation, overdue flags, quote expiry). No Redis or separate worker, so one systemd unit stays enough.

### 12. Email via SMTP
Nodemailer with configurable SMTP (for example, the business's Google Workspace/Gmail or any low-cost provider) for quote links, rental confirmations, and new-request notifications. Simple React-free HTML templates rendered server-side.

### 13. Public endpoints and abuse protection
Public routes: `POST /api/public/quote-requests`, `GET/POST /api/public/quotes/:token`, `POST /api/webhooks/square`. Quote tokens are 32 random bytes (base64url). Quote request form uses a honeypot field plus per-IP rate limiting; Cloudflare Turnstile can be added later without spec changes.

### 14. Deployment
Single Node process serving the API and built SPA, run as a systemd service on the Pi 5 (a Docker Compose file is also provided for portability). HTTPS and public access via Cloudflare Tunnel, so there are no open router ports. Database on SSD/NVMe rather than an SD card. Continuous SQLite replication to S3-compatible storage (Backblaze B2) with Litestream.

### 15. Testing
Vitest for shared domain logic and server integration tests (in-memory SQLite, Square SDK mocked at the client boundary), React Testing Library for key forms, and Playwright smoke tests for the main flows: request, quote, accept, deposit webhook, check-out, check-in.

## Risks / Trade-offs

- [Square API details (deposit requests, saved-card behavior, webhook payloads) may differ from assumptions] → Spike against the Square sandbox before building the invoice flow; keep all Square calls behind one adapter module.
- [Charging a saved card after the event needs clear customer consent] → Terms and conditions shown at quote acceptance state loss and damage fees and card-on-file authorization; losses default to "proposed" and require a human to approve.
- [Typed-name acceptance may be weaker than a dedicated e-signature service] → Store revision, name, timestamp, IP, and user agent; the business should have its terms reviewed. A DocuSeal integration can replace it later.
- [Pi hardware failure or SD card corruption] → SSD storage, Litestream continuous backups, and a documented restore procedure.
- [Home internet outage takes the public form offline] → Accepted for the MVP; the stack is portable to a cheap VPS without changes.
- [A custom capacity calendar costs more than an off-the-shelf calendar] → Keep it a simple grid; capacity logic lives in shared, tested functions.
- [Door revenue is self-reported by venues] → Settlement records who entered it and when; disputes are handled outside the system.
- [SQLite write concurrency] → Not a concern at this scale with WAL; the PostgreSQL migration path is preserved by the portability rules.

## Migration Plan

Greenfield deployment, so there is no data migration.
1. Provision the Pi 5 with an SSD, Node.js LTS, and Cloudflare Tunnel; configure environment variables (app secret, initial admin password, SMTP, Square sandbox credentials).
2. Run database migrations and first-run seeding; sign in as kali and complete settings (terms for each booking type, rental deposit settings, delivery fee, packages, DJs).
3. Validate end to end against the Square sandbox, then switch to production credentials and register the production webhook URL.
4. Enable Litestream and verify a restore on another machine.
Rollback: stop the service, restore the last good build and the Litestream snapshot.

## Open Questions

- Package names, prices, and loss fee amounts. These are admin-configured data and need no code changes.
- Default number of days before an event that the balance is due, and the default suggested delivery fee. Both are settings.
- Wording of terms and conditions. This is tenant-provided content.
