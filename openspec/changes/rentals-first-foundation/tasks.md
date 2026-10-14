# Tasks

## 1. Project scaffolding

- [x] 1.1 Create pnpm workspace with `apps/web`, `apps/server`, and `packages/shared`, shared TypeScript config, ESLint, and Prettier; verify `pnpm install`, `pnpm lint`, and `pnpm typecheck` succeed on the empty packages
- [x] 1.2 Scaffold `apps/web` with Vite, React, TypeScript, Tailwind CSS, and shadcn/ui (init plus Button, Card, Input, Form, Dialog, Sheet, Table, Badge, Calendar, Popover, Command, Tabs, Select, Sonner, Sidebar), and Lucide icons; verify `pnpm --filter web build` succeeds
- [x] 1.3 Scaffold `apps/server` with Fastify, Zod, and `@fastify/static` serving the built SPA, plus a `GET /api/health` route; verify a Vitest test hits the health route successfully
- [x] 1.4 Set up Vitest in all packages and Playwright in `apps/web`; add root `test` and `e2e` scripts; verify a sample test in each package runs via `pnpm test`

## 2. Shared domain logic

- [x] 2.1 Implement money helpers (integer cents, basis points, half-up rounding) in `packages/shared`; verify with unit tests including rounding edge cases
- [x] 2.2 Implement the booking-type policy (allowed pricing terms, deposit required, initial status, invoice plan, loss charges) plus `quoteTotal` (line items, packages, add-ons, delivery fee) and `holdingDeposit` (20% for equipment rentals, zero for full-service); verify unit tests match the quote spec scenarios ($1,000 rental to $200 deposit, $1,000 full-service to no deposit, split terms rejected for rentals)
- [x] 2.3 Implement `settlementAmount` for door split and guarantee plus split; verify unit tests match the bookings spec scenarios ($1,500 at 40% to $600, $500 guarantee with $1,000 door to $500)
- [x] 2.4 Implement capacity folding (hold windows with turnaround buffer, tentative vs confirmed, staff counts, conflicts) as pure functions; verify unit tests cover the Friday-to-Monday buffer, overbooking shortfall, and split-fleet scenarios
- [x] 2.5 Implement `lossCharge` (missing x fee, found-item corrections, equipment rentals only); verify unit tests for the 3-missing ($180) rental, a full-service loss with no charge, and the 2-found correction
- [x] 2.6 Define shared Zod schemas for all API inputs (organizations, contacts, opportunities, quote request, quotes, bookings, checkout, settings); verify schema tests reject the invalid inputs described in the specs

## 3. Database and tenancy layer

- [x] 3.1 Add Drizzle with `better-sqlite3` (WAL, foreign keys on) and define the full schema from design Decision 7 with `tenant_id` on every business table; verify `drizzle-kit generate` produces a migration that applies cleanly to a fresh database
- [x] 3.2 Implement a tenant-scoped repository layer for all entities; verify integration tests show tenant A cannot list or fetch tenant B records (fetches return not found)
- [x] 3.3 Implement the activity log repository with automatic entries hook; verify tests show stage changes and manual notes produce activity entries
- [x] 3.4 Implement the `job` outbox table and in-process scheduler with retries and exponential backoff; verify tests show a failing job is retried and a succeeding job completes once

## 4. Authentication, roles, and seeding

- [x] 4.1 Implement Argon2id password hashing, sessions table, sign-in, sign-out, idle/absolute expiry, and Origin checks; verify integration tests for successful sign-in, a generic error on bad password, sign-out invalidation, and unauthenticated 401s
- [x] 4.2 Implement admin/staff role guards and admin user management API; verify tests that staff cannot create users and admin can create a staff user who signs in
- [x] 4.3 Implement idempotent first-run seeding (tenant "Undercover Dance Party", admin "kali", headphones x100 pooled, transmitters TX-1 to TX-3) using `INITIAL_ADMIN_PASSWORD`, plus a one-time setup screen when it is absent; verify tests for seeding, no duplicates on restart, and the setup-required path
- [x] 4.4 Build sign-in, first-run setup, and user management pages in the web app; verify a Playwright test signs in as kali and reaches the dashboard

## 5. App shell and UI foundations

- [x] 5.1 Build the dashboard layout with the shadcn sidebar (Dashboard, Pipeline, Organizations, Contacts, Quotes, Bookings, Calendar, Inventory, Money Owed, Settings), header breadcrumbs, and a user menu; verify navigation works on desktop and in the mobile sheet
- [x] 5.2 Add a theme provider with light, dark, and system modes and a toggle; verify the preference persists across reloads
- [x] 5.3 Add a Command palette (Ctrl/Cmd+K) for navigation and record search; verify keyboard-only navigation to each section
- [x] 5.4 Create a reusable DataTable (TanStack Table: sorting, filtering, pagination, column visibility) and a form pattern (React Hook Form + Zod + shadcn Form); verify component tests for sorting and validation messages
- [x] 5.5 Set up a TanStack Query API client with session-expiry handling that redirects to sign-in; verify an expired session redirects
- [x] 5.6 Build a tenant settings page (rental deposit %, buffer days, rental balance due days, full-service invoice due offset, suggested delivery fee, service areas, terms per booking type, notification email); verify settings save and are used by the quote calculations

## 6. Equipment inventory and packages

- [x] 6.1 Implement equipment type, unit, adjustment, and out-of-service APIs per the equipment-inventory spec; verify integration tests for buying 50 headphones (100 to 150), retiring a transmitter, and 5 out of service reducing capacity
- [x] 6.2 Implement the rental package catalog API (create, edit, deactivate) with per-item loss fees; verify tests that deactivated packages cannot be added to new quotes
- [x] 6.3 Build inventory and package pages (pooled counts, transmitter list, adjustment history, package editor); verify a Playwright test creates the "Party 50" package

## 7. Customer relationships

- [x] 7.1 Implement organization and contact APIs with search, archive, and duplicate detection; verify integration tests for create/search, archived filter, and the duplicate email warning
- [x] 7.2 Implement the opportunity API with stages and required loss reasons (including "date unavailable due to capacity"); verify tests that Lost without a reason is rejected and stage changes create activity entries
- [x] 7.3 Build organization and contact list and detail pages with activity timelines and a note/call logging dialog; verify a component test logs a note that appears in the timeline
- [x] 7.4 Build the pipeline board with drag-and-drop between stages (dnd-kit, keyboard accessible) and a loss-reason dialog; verify a Playwright test moves an opportunity and marks one Lost

## 8. Email and quote requests

- [x] 8.1 Implement a Nodemailer SMTP mail service with HTML templates (new request, quote sent, rental confirmation) and a dev mode that logs emails; verify tests render each template with expected fields
- [x] 8.2 Implement the public quote request endpoint with validation, honeypot, and per-IP rate limiting, creating or matching contacts/organizations and a Quote Requested opportunity; verify integration tests for new requester, returning requester, invalid input, rate limit, and silent honeypot drop
- [x] 8.3 Notify on new requests (dashboard indicator plus email to the configured address); verify a test shows the email is queued and the request appears as new
- [x] 8.4 Build the public, mobile-friendly quote request page with a branded minimal layout; verify a Playwright test submits the form and sees the confirmation

## 9. Quotes

- [x] 9.1 Implement quote and revision APIs with booking type, dates, type-specific pricing (rental packages/add-ons/delivery fee; full-service flat, split, or guarantee plus split), rental deposit, and full-service recurring series dates; verify integration tests for every quote spec scenario, including split terms rejected for rentals
- [x] 9.2 Add availability warnings to quote responses using the capacity functions; verify a test where 80 required headphones against 40 committed returns a warning
- [x] 9.3 Implement sending (public token, expiry, email, opportunity to Quoted) and revisions (new token, old link invalid); verify integration tests for both
- [x] 9.4 Implement public quote view, accept (type-specific terms checkbox, typed name, IP/user agent recorded; rentals create bookings Awaiting Deposit, full-service creates Confirmed bookings; invoice job enqueued when the policy calls for one), and decline (flags loss reason); verify tests for rental accept, full-service accept, expired link, and decline
- [x] 9.5 Build the quote builder UI with a booking-type switch that shows the matching fields (rental: package picker, delivery-zone toggle, deposit; full-service: pricing terms, series builder), live totals from shared functions, and capacity warnings; verify Playwright tests build and send one quote of each type
- [x] 9.6 Build the public quote page (booking type, line items or split terms, deposit for rentals, type-specific terms, accept/decline); verify a Playwright test accepts a quote and sees the confirmation

## 10. Availability calendar and staff

- [x] 10.1 Implement staff member and unavailability APIs (seed two DJ placeholders editable by admin); verify a test where a DJ unavailable on a date shows at most one DJ available
- [x] 10.2 Implement the availability API over a date range (headphones, transmitters, staff, tentative/confirmed, quote indicators, conflicts); verify integration tests matching the availability-calendar spec scenarios
- [x] 10.3 Build the month/week/day capacity calendar with capacity bars, tentative vs confirmed styling, quote indicators, and conflict highlighting; verify a component test renders a conflict day and keyboard navigation between days
- [x] 10.4 Add a dashboard conflicts widget; verify it lists a seeded overbooked date

## 11. Bookings

- [x] 11.1 Implement the booking lifecycle API (Awaiting Deposit for rentals only, Confirmed, Out, Returned, Closed, Cancelled) with admin manual confirmation of rentals, cancellation releasing holds, and overbooking confirmation; verify integration tests for each transition per booking type and invalid transitions
- [x] 11.2 Implement full-service event details (DJ assignment, times, channels, run-of-show) and the mobile event sheet; verify a test that an assigned DJ is committed on that date
- [x] 11.3 Implement rental logistics details and the rental confirmation email; verify a test that the email includes delivery, return, address, and instructions
- [x] 11.4 Implement door-split settlement for full-service bookings (amount owed, balance due, entered by/at); verify tests for the $1,500 and $1,000 scenarios
- [x] 11.5 Implement closure rules (checked in, settled, zero balance, or admin override with reason); verify a test that closing with a balance is blocked
- [x] 11.6 Build booking list and detail pages (tabs for overview, logistics or staffing, equipment, payments, activity) and the settlement dialog; verify a Playwright test confirms, settles, and closes a booking

## 12. Equipment check-out and check-in

- [x] 12.1 Implement check-out and check-in APIs, including quantity-mismatch confirmation, missing/damaged calculation, inventory adjustments, and proposed loss charges; verify tests for the 50-out/47-back ($180) and 2-damaged scenarios
- [x] 12.2 Implement overdue detection (scheduled job) and found-item corrections; verify tests for an overdue flag and the 2-found correction
- [x] 12.3 Build mobile check-out and check-in screens (large steppers, transmitter toggles, confirmation summary); verify a Playwright test at a mobile viewport completes check-out and check-in

## 13. Square payments

- [ ] 13.1 Spike against the Square sandbox: create customer, order, and invoices (rental with deposit and balance requests plus card saving; full-service single payment request), receive a webhook, and charge a saved card; record any differences from design Decision 10 in design.md, verified by a working sandbox script
- [x] 13.2 Implement Square settings (encrypted token storage with AES-256-GCM, location selection, test call on save); verify tests that invalid credentials are not activated and the token is never returned by the API
- [x] 13.3 Implement the Square adapter (customer find/create, order and invoice create/publish, card charge) with idempotency keys; verify tests with a mocked Square client for rental deposit/balance, full-service flat-fee, no invoice for split at acceptance, and settlement invoices
- [x] 13.4 Wire invoice creation through the job outbox on acceptance and settlement, retrying when Square is unavailable; verify tests that acceptance succeeds offline and the invoice is created on retry
- [x] 13.5 Implement the webhook endpoint (HMAC signature verification, idempotent by event ID) and the 15-minute reconciliation job; verify tests that a rental deposit paid confirms the booking, a forged signature is rejected, and reconciliation records a missed payment
- [x] 13.6 Implement external payment recording and loss charge approve/adjust/waive (saved card charge or invoice fallback); verify tests for the cash payment, saved-card, no-card, and waiver scenarios
- [x] 13.7 Build the Money Owed page (outstanding, due date, overdue, Square invoice link, sorting) and booking payments tab actions; verify a Playwright test shows an overdue balance

## 14. Dashboard

- [x] 14.1 Build the dashboard home: new quote requests, upcoming bookings (next 14 days), conflicts, overdue returns, money owed totals, and pending loss charges; verify a component test renders each widget from fixture data

## 15. Deployment and operations

- [x] 15.1 Add a production build that bundles the server and serves the SPA from one process, plus `.env.example` documenting all variables; verify `pnpm build && node apps/server/dist/index.js` serves the app locally
- [ ] 15.2 Add a systemd unit and a Docker Compose file for ARM64; verify the Docker image builds for `linux/arm64`
- [ ] 15.3 Write `docs/deployment.md` (Pi 5 with SSD, Cloudflare Tunnel, Square webhook registration, SMTP, Litestream to B2, restore procedure) and add a Litestream config; verify a restore from a Litestream replica on another machine boots the app with data intact
- [x] 15.4 Write `README.md` covering local development, seeding, testing, and project structure; verify a fresh clone following the README reaches the sign-in page

## 16. End-to-end integration

- [x] 16.1 Playwright equipment rental flow across groups: public request, pipeline, rental quote with package and delivery fee, send, customer accept, simulated deposit webhook, calendar shows confirmed hold, check-out, check-in with 3 missing, loss charge approved, booking closed; verify the test passes against the Square mock
- [x] 16.2 Playwright full-service door-split flow: series quote for a bar, accept (bookings Confirmed with no deposit or invoice), settle one occurrence, settlement invoice created; verify the test passes
- [x] 16.3 Accessibility pass with axe on main pages in light and dark mode; verify no serious or critical violations

## Workflow follow-up

- Archive the change with `/opsx-archive` after implementation is reviewed and deployed.
