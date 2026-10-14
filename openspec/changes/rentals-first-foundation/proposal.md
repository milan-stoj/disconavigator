# Proposal

## Why

Undercover Dance Party (a silent disco company in Milwaukee and Madison) runs its business without any operational software: leads, quotes, gear, staff, and payments are tracked ad hoc. The business is shifting from mostly full-service events where it runs the show (~80%, mainly bars) toward equipment rentals where customers run their own event, which raises the stakes on availability, deposits, and lost equipment. Disco Controller's first change establishes the foundation of a silent-disco-specific business suite, rentals first, so every later capability (lead generation, analytics, multi-tenant SaaS) has a shared core to build on.

## What Changes

- New self-hostable web application (Disco Controller) with tenant-scoped data, admin login, and a seeded tenant: **Undercover Dance Party** with admin user **kali**, 100 headphones, and 3 transmitters.
- CRM: organizations, contacts, an opportunity pipeline (lead → won/lost, including a "lost: capacity" reason), and an activity log.
- Public quote request form that creates a lead and opportunity; all bookings are priced manually by staff.
- Quote builder with two distinct booking types:
  - **Equipment rental** (customer rents gear and runs the event): rental packages with add-ons, a delivery fee outside the Milwaukee and Madison metros, and a 20% holding deposit.
  - **Full-service event** (the business provides DJs and runs the show): flat fee, door split, or guarantee + split pricing, recurring event series, and no holding deposit.
- Customers accept quotes online by agreeing to the terms for that booking type.
- Equipment inventory: pooled headphones, serialized transmitters, and a rental package catalog with per-item loss fees.
- Availability calendar showing headphones, transmitters, and DJ staff per day, including multi-day rental blocks and turnaround buffers, with conflict warnings.
- Bookings with full-service details (DJ assignment, run-of-show) or equipment rental details (delivery/pickup, customer instructions), plus post-event door-split settlement.
- Mobile-friendly equipment check-out and check-in with counts, recording missing or damaged items.
- Square integration: equipment rental invoices with a 20% holding deposit and balance, full-service invoices (flat fee, or after settlement for split deals), payment-status sync, a "money owed" view, and loss/damage charges for rentals.

## Capabilities

### New Capabilities
- `account-access`: Tenants, users, authentication, roles, and first-run seeding of the initial tenant and admin.
- `customer-relationships`: Organizations, contacts, opportunity pipeline stages, loss reasons, and activity history.
- `quote-requests`: Public, unauthenticated quote request intake that creates leads.
- `quotes`: Building, sending, and accepting quotes, including the equipment rental and full-service booking types, pricing terms, packages, add-ons, delivery fees, recurrence, and rental deposit calculation.
- `equipment-inventory`: Equipment types, pooled and serialized units, and the rental package catalog.
- `availability-calendar`: Per-day capacity of headphones, transmitters, and staff, holds from bookings, turnaround buffers, and conflict detection.
- `bookings`: Confirmed event and rental records, their lifecycle, staffing, run-of-show, delivery details, and door-split settlement.
- `equipment-checkout`: Check-out and check-in of equipment for bookings, with loss and damage recording.
- `square-payments`: Square invoice creation, deposit/balance tracking, payment status sync, outstanding balances, and loss/damage charges.

### Modified Capabilities
- None (greenfield project).

## Impact

- New codebase: React + TypeScript frontend (shadcn/ui, Tailwind CSS, Lucide icons), Node.js backend, SQLite database.
- New external dependency: Square APIs (Customers, Invoices, Payments, Cards, Webhooks) with a Square developer application and access token.
- Deployment target: a Raspberry Pi 5, with a public HTTPS endpoint (for the quote request form, customer quote acceptance, and Square webhooks) and off-device database backups.
- Out of scope for this change: automated lead discovery, outreach/email campaigns, competitor tracking, profitability analytics, multi-tenant self-signup, and automatic distance-based delivery pricing.
- Assumption: full-service bookings are confirmed when the customer accepts the quote, since they require no deposit.
