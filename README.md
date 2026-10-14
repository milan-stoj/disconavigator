# Disco Controller

Business management for silent disco companies: quote requests, a sales pipeline,
quotes, bookings, equipment check-out and check-in, an availability calendar, and
Square invoicing. The first tenant is **Undercover Dance Party** (Milwaukee and
Madison), with admin user `kali`.

It runs as one Node.js process with a SQLite database, small enough for a
Raspberry Pi 5. See [docs/deployment.md](docs/deployment.md) for production.

## Requirements

- Node.js 22 or later
- pnpm 12 (`npm install -g pnpm@12`)
- For end-to-end tests: Playwright's Chromium (`pnpm --filter web exec playwright install chromium`)

## Local development

```bash
git clone <repo URL> disco-controller
cd disco-controller
pnpm install

# Development settings (loaded by the server from the repo root)
cat > .env <<'ENV'
INITIAL_ADMIN_PASSWORD=dev-password-123
SQUARE_MODE=mock
ENV

pnpm dev
```

Open <http://localhost:5173> and sign in as **kali** / `dev-password-123`.

`pnpm dev` runs two processes:

| Process | URL                   | Notes                                              |
| ------- | --------------------- | -------------------------------------------------- |
| Web     | http://localhost:5173 | Vite with hot reload; proxies `/api` to the server |
| Server  | http://localhost:3000 | Fastify, restarts on change (`tsx watch`)          |

The database is created at `apps/server/data/disco.db` (relative to the server's
working directory; set `DATABASE_PATH` to change it) and migrated automatically.
Delete that folder to start over.

Every variable is documented in [`.env.example`](.env.example). That file holds
production values; for development the two lines above are enough. Without
`SMTP_URL`, emails are printed to the server log instead of sent.

### Seed data

On first start the server seeds the tenant, so the app is usable right away:

- Tenant **Undercover Dance Party** (`undercover-dance-party`), time zone America/Chicago
- Admin user **kali**. The password comes from `INITIAL_ADMIN_PASSWORD`. If it is
  not set, the browser shows a one-time setup page to choose it.
- 100 **Headphones** (pooled, $60 loss fee) and 3 **Transmitters** TX-1 to TX-3
  (serialized, $300 loss fee)
- Two DJs, **DJ 1** and **DJ 2** (rename them under Settings → Staff)
- Default business settings: 20% holding deposit on equipment rentals (balance due
  7 days before the rental), a $75 delivery fee outside the Milwaukee and Madison
  metros, and rental and full-service terms

Seeding only runs when the tenant does not exist yet, so it never overwrites your data.
The public quote request form is at <http://localhost:5173/request/undercover-dance-party>.

### Square in development

With `SQUARE_MODE=mock`, Square is replaced by an in-memory fake. Connect it in
**Settings → Square** with any token (tokens starting with `invalid` are
rejected). To simulate a customer paying an invoice, call the dev-only endpoint
as an admin: `POST /api/dev/square/invoices/:invoiceId/pay`. To try the real
Square sandbox, remove `SQUARE_MODE` and paste a sandbox access token instead.
The mock cannot run with `NODE_ENV=production`.

## Testing

```bash
pnpm test         # unit and API tests (Vitest) for every package
pnpm typecheck    # TypeScript, all packages
pnpm lint         # ESLint
pnpm format       # Prettier (writes changes)
pnpm e2e          # Playwright end-to-end tests
```

- **Server tests** (`apps/server/test`) build the app against an in-memory SQLite
  database with the Square mock, and drive it through HTTP with `app.inject`.
- **Web tests** (`apps/web/src/**/*.test.tsx`) render pages with Testing Library
  and a mocked `fetch`.
- **End-to-end tests** (`apps/web/e2e`) build the web app, start the real server on
  port 4173 with a fresh temporary database and the Square mock, and sign in as
  `kali`. Tests share one database, so they create uniquely named records.

Run one file with `cd apps/server && pnpm vitest run test/square.test.ts`, or
`cd apps/web && pnpm exec playwright test money-owed`.

## Production build

```bash
pnpm build
NODE_ENV=production APP_SECRET=$(openssl rand -base64 48) node apps/server/dist/index.js
```

`pnpm build` bundles the server into `apps/server/dist/index.js`, which serves the
API and the built web app (`apps/web/dist`) from one process on port 3000.
Deployment with systemd or Docker, Cloudflare Tunnel, Square webhooks, email, and
Litestream backups is covered in [docs/deployment.md](docs/deployment.md).

## Project structure

```
apps/
  server/                Fastify API (Node.js, TypeScript)
    src/
      app.ts             App assembly: plugins, routes, background jobs
      config.ts          Environment variables
      auth/              Sessions, sign-in, CSRF origin checks, roles
      db/                Drizzle schema, tenant-scoped repository, migrations runner
      routes/            HTTP routes, one file per area
      services/          Business logic (quotes, bookings, checkout, invoicing, ...)
        square/          Square gateway: live SDK client and in-memory mock
    drizzle/             SQL migrations (generate with `pnpm db:generate`)
    test/                Vitest API tests
  web/                   React single-page app (Vite, TypeScript)
    src/
      components/        Shared components; ui/ holds the shadcn/ui primitives
      lib/               API client, TanStack Query hooks, formatting
      pages/             Screens, grouped by area
      routes.tsx         Routes and breadcrumbs
    e2e/                 Playwright tests
packages/
  shared/                Code used by both apps: Zod schemas, money and date
                         helpers, quote pricing, capacity, booking policies
deploy/                  systemd unit and Litestream config
docs/                    Deployment guide
openspec/                Product specs and change proposals
```

### Stack

- **Web:** React, TypeScript, Vite, Tailwind CSS, [shadcn/ui](https://ui.shadcn.com),
  Lucide icons, TanStack Query and Table, React Hook Form with Zod
- **Server:** Node.js, Fastify, Drizzle ORM, SQLite (better-sqlite3), Square SDK,
  Nodemailer
- **Data rules:** every tenant-owned table has a `tenant_id`, and all queries go
  through a tenant-scoped repository so the app can grow into multi-tenant SaaS.
  Money is stored as integer cents and dates as ISO `YYYY-MM-DD` strings.

### Database changes

Edit `apps/server/src/db/schema.ts`, then run `pnpm db:generate` to create a
migration in `apps/server/drizzle/`. Migrations run automatically when the server starts.
