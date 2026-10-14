# Spec Delta

## Purpose

Uses Square as the system of record for invoices and payments, while Disco Controller tracks what each booking owes and confirms equipment rentals when deposits are paid.

## ADDED Requirements

### Requirement: Square connection
An admin SHALL be able to connect the tenant to a Square account and location. Credentials SHALL be stored server-side, never shown after entry, and verified with a test call when saved.

#### Scenario: Valid connection
- **WHEN** an admin saves valid Square credentials and selects a location
- **THEN** the settings page shows Square as connected to that location

#### Scenario: Invalid credentials
- **WHEN** an admin saves credentials that Square rejects
- **THEN** the system shows the connection failed and does not save them as active

### Requirement: Customer linking
When creating the first invoice for a contact, the system SHALL link the contact to a Square customer, reusing an existing Square customer with the same email when one exists.

#### Scenario: Existing Square customer
- **WHEN** an invoice is created for a contact whose email matches an existing Square customer
- **THEN** the contact is linked to that Square customer and no duplicate is created

### Requirement: Equipment rental invoice
When an equipment rental quote is accepted, the system SHALL create and publish a Square invoice requesting the holding deposit immediately and the balance by a configurable number of days before dispatch, and SHALL allow the customer to save a card on file.

#### Scenario: Rental invoice
- **WHEN** a $1,000 equipment rental quote is accepted
- **THEN** a Square invoice is published with a $200 deposit due immediately and an $800 balance due before dispatch

### Requirement: Full-service flat fee invoice
When a full-service flat-fee quote is accepted, the system SHALL create and publish a Square invoice for the full total, with no deposit, due a configurable number of days relative to the event date (default: the event date).

#### Scenario: Flat fee invoice
- **WHEN** an $800 full-service flat-fee quote is accepted
- **THEN** a Square invoice for $800 with no deposit is published, due on the event date

### Requirement: Settlement invoice
Completing a door-split settlement with a balance due SHALL create and publish a Square invoice to the venue for that balance. No invoice SHALL be created for split-based full-service bookings before settlement.

#### Scenario: Settlement invoice
- **WHEN** a settlement records a $600 balance due
- **THEN** a $600 Square invoice is published to the venue's contact

#### Scenario: No invoice before settlement
- **WHEN** a full-service door-split quote is accepted
- **THEN** no Square invoice is created until settlement

### Requirement: Resilient invoice creation
If Square cannot be reached when an invoice is required, the triggering action SHALL still succeed, the booking SHALL be marked as needing an invoice, and the system SHALL retry invoice creation.

#### Scenario: Square unavailable
- **WHEN** Square cannot be reached as a quote is accepted
- **THEN** the acceptance still succeeds, the booking is marked as needing an invoice, and invoice creation is retried

### Requirement: Payment status sync
The system SHALL update each booking's paid and outstanding amounts from Square, using verified Square webhooks with periodic reconciliation as a fallback. Webhooks that fail signature verification SHALL be rejected.

#### Scenario: Rental deposit paid
- **WHEN** Square reports that an equipment rental's deposit was paid
- **THEN** the booking records the payment and becomes Confirmed

#### Scenario: Forged webhook
- **WHEN** a webhook request arrives with an invalid signature
- **THEN** the system rejects it and changes no records

#### Scenario: Missed webhook
- **WHEN** a payment occurs in Square but its webhook is not received
- **THEN** the next reconciliation run records the payment

### Requirement: Money owed view
The system SHALL show a list of bookings with outstanding amounts, including booking type, amount, due date, overdue status, and a link to the Square invoice, sortable by due date and amount.

#### Scenario: Overdue balance listed
- **WHEN** a booking's balance due date has passed without payment
- **THEN** it appears in the money owed list marked overdue

### Requirement: Payments outside Square
Users SHALL be able to record a payment received outside Square (cash or check) against a booking with amount, date, and method, and it SHALL count toward the booking's paid amount.

#### Scenario: Cash payment
- **WHEN** a user records a $300 cash payment on a booking with a $300 balance
- **THEN** the booking shows no balance due

### Requirement: Loss and damage charges
For equipment rentals, after check-in proposes a loss charge, a user SHALL be able to approve, adjust, or waive it. When approved, the system SHALL charge the customer's saved Square card if authorized, otherwise send a Square invoice.

#### Scenario: Charge saved card
- **WHEN** a user approves a $180 loss charge for a customer with a saved card
- **THEN** Square charges the card $180 and the payment is recorded on the booking

#### Scenario: No saved card
- **WHEN** a user approves a loss charge for a customer without a saved card
- **THEN** a Square invoice for the amount is published to the customer

#### Scenario: Waived charge
- **WHEN** a user waives a proposed loss charge with a reason
- **THEN** no charge is made and the waiver and reason are recorded
