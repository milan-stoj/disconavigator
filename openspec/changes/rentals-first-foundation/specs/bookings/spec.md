# Spec Delta

## Purpose

Manages confirmed equipment rentals and full-service events from acceptance to completion, including staffing, logistics, and settlement of door-split deals.

## ADDED Requirements

### Requirement: Booking creation from accepted quotes
Accepting a quote SHALL create a booking with the quote's booking type, dates, location, equipment requirements, and pricing terms. A recurring series quote SHALL create one linked booking per occurrence.

#### Scenario: Series accepted
- **WHEN** a customer accepts a six-date full-service series quote
- **THEN** six full-service bookings are created, each linked to the series and the accepted quote

### Requirement: Booking lifecycle
Bookings SHALL move through Awaiting Deposit (equipment rentals only), Confirmed, Out (equipment checked out), Returned, and Closed, or to Cancelled.

#### Scenario: Rental starts awaiting deposit
- **WHEN** a customer accepts an equipment rental quote
- **THEN** the booking is created as Awaiting Deposit

#### Scenario: Full-service confirmed on acceptance
- **WHEN** a customer accepts a full-service event quote
- **THEN** the booking is created as Confirmed and the opportunity becomes Won

### Requirement: Rental confirmation by deposit
An equipment rental booking SHALL become Confirmed when its holding deposit is paid, or when an admin overrides with a recorded reason.

#### Scenario: Deposit confirms rental
- **WHEN** the holding deposit for an Awaiting Deposit rental is paid
- **THEN** the booking becomes Confirmed and the opportunity becomes Won

#### Scenario: Manual confirmation
- **WHEN** an admin confirms a rental without a deposit and enters the reason "repeat client, pays at pickup"
- **THEN** the booking becomes Confirmed and the reason is recorded in its activity history

### Requirement: Cancellation
Users SHALL be able to cancel a booking with a reason. Cancelling SHALL release its calendar holds and leave payment records unchanged for manual refund handling.

#### Scenario: Cancel booking
- **WHEN** a user cancels a Confirmed equipment rental with a paid deposit
- **THEN** its equipment is no longer committed on the calendar and the paid deposit remains recorded

### Requirement: Full-service event details
Full-service bookings SHALL record assigned DJs, venue contact, load-in, start, and end times, number of channels, and run-of-show notes, and SHALL provide a printable or mobile event sheet.

#### Scenario: Assign DJ
- **WHEN** a user assigns a DJ to a full-service booking
- **THEN** the DJ counts as committed on that date and the event sheet lists them

### Requirement: Equipment rental logistics
Equipment rental bookings SHALL record pickup or delivery, the dispatch and return date and time, delivery address, and customer instructions. The system SHALL let users email the customer a rental confirmation with these details and usage instructions.

#### Scenario: Send rental confirmation
- **WHEN** a user sends the rental confirmation for a Confirmed delivery rental
- **THEN** the customer receives an email with delivery time, return time, address, and usage instructions

### Requirement: Door-split settlement
After the event, full-service bookings with door split or guarantee plus split terms SHALL require a settlement: the user enters the door revenue reported by the venue and the system records the amount owed as the balance due.

#### Scenario: Split settlement
- **WHEN** a 40% split booking is settled with $1,500 reported door revenue
- **THEN** the amount owed and balance due are $600

#### Scenario: Guarantee exceeds split
- **WHEN** a $500 guarantee plus 40% split booking is settled with $1,000 door revenue
- **THEN** the amount owed and balance due are $500

### Requirement: Booking closure
A booking SHALL be closable only when its equipment has been checked in (or it had none), required settlement is complete, and no balance remains, unless an admin closes it with a recorded reason.

#### Scenario: Close blocked by balance
- **WHEN** a user tries to close a Returned booking with a balance due
- **THEN** the system prevents closing and shows the outstanding balance
