# Spec Delta

## Purpose

Shows how many headphones, transmitters, and staff are free on each day so the business never double-books its small fleet or its DJs.

## ADDED Requirements

### Requirement: Daily capacity view
The system SHALL show a calendar with month, week, and day views. For each day it SHALL show committed and available headphones, transmitters, and DJ staff, plus the bookings and quotes using them.

#### Scenario: Day with one booking
- **WHEN** a full-service booking on Saturday uses 100 headphones, 2 transmitters, and one DJ
- **THEN** Saturday shows 0 headphones, 1 transmitter, and 1 DJ available, and lists the booking

### Requirement: Equipment holds span the full rental period
Equipment for a booking SHALL count as committed from the dispatch date through the return date, plus a configurable turnaround buffer (default one day) for cleaning and charging.

#### Scenario: Weekend rental with buffer
- **WHEN** a rental is dispatched Friday and returned Sunday with a one-day buffer
- **THEN** its equipment counts as committed Friday through Monday

### Requirement: Hold strength
Equipment rentals awaiting deposit SHALL appear as tentative holds, and Confirmed bookings of either type as confirmed. Sent and draft quotes SHALL appear as soft indicators that do not reduce available capacity.

#### Scenario: Tentative versus confirmed
- **WHEN** one equipment rental awaits its deposit and a Confirmed full-service booking falls on the same day
- **THEN** the calendar distinguishes the tentative booking from the confirmed booking and both reduce available capacity

#### Scenario: Quote does not consume capacity
- **WHEN** a sent quote requires 60 headphones on a date with no bookings
- **THEN** the date still shows 100 headphones available and shows the pending quote as an indicator

### Requirement: Staff availability
The system SHALL track staff members who can work events (initially two DJs), allow marking dates when a staff member is unavailable, and count assigned staff against daily staff capacity.

#### Scenario: DJ unavailable
- **WHEN** one DJ is marked unavailable on a date
- **THEN** that date shows at most one DJ available

### Requirement: Conflict detection
The system SHALL flag any date where committed equipment or staff exceeds available capacity, including when two full-service events share a night and the fleet would need to be split. Overbooking SHALL be allowed only after explicit user confirmation.

#### Scenario: Overbooking warning
- **WHEN** a user confirms a booking that would commit 130 headphones on a date with 100 owned
- **THEN** the system warns of a 30-headphone shortfall and requires explicit confirmation to proceed

#### Scenario: Conflicts surfaced
- **WHEN** any date has a capacity conflict
- **THEN** the conflict is highlighted on the calendar and listed on the dashboard
