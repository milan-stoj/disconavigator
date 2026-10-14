# Spec Delta

## Purpose

Records exactly what equipment leaves and returns for each booking so missing or damaged gear is caught immediately and can be charged or written off.

## ADDED Requirements

### Requirement: Mobile check-out
The system SHALL provide a phone-friendly check-out screen for a Confirmed booking where a user records the headphone quantity and the specific transmitters leaving. Completing it SHALL move the booking to Out.

#### Scenario: Check out rental
- **WHEN** a user checks out 50 headphones and transmitter "TX-2" for a Confirmed rental
- **THEN** the booking becomes Out and records who checked it out, when, and what left

#### Scenario: Check-out differs from requirement
- **WHEN** the checked-out quantity differs from the booking's required quantity
- **THEN** the system asks the user to confirm the difference before completing

### Requirement: Mobile check-in
The system SHALL provide a phone-friendly check-in screen for an Out booking where a user records returned headphones, which transmitters returned, and the number of damaged items. Completing it SHALL move the booking to Returned.

#### Scenario: Full return
- **WHEN** all 50 headphones and TX-2 are checked in undamaged
- **THEN** the booking becomes Returned with no losses recorded

### Requirement: Loss and damage recording
Check-in SHALL calculate missing items as checked-out minus returned. Missing and damaged items SHALL be recorded on the booking and inventory adjusted. For equipment rentals only, a loss charge SHALL be proposed using the package or equipment type loss fee.

#### Scenario: Missing headphones on a rental
- **WHEN** an equipment rental with a $60 headphone loss fee checks out 50 headphones and 47 are returned
- **THEN** 3 headphones are recorded missing, a $180 loss charge is proposed, and owned headphones decrease by 3

#### Scenario: Missing headphones at a full-service event
- **WHEN** a full-service booking checks out 100 headphones and 98 are returned
- **THEN** 2 headphones are recorded missing, owned headphones decrease by 2, and no customer charge is proposed

#### Scenario: Damaged headphones
- **WHEN** 2 returned headphones are marked damaged
- **THEN** 2 headphones are moved out of service and recorded as damaged on the booking

### Requirement: Late returns
The system SHALL flag Out bookings whose return date and time have passed on the dashboard and calendar.

#### Scenario: Overdue rental
- **WHEN** a rental's return time passes without check-in
- **THEN** the booking is marked overdue on the dashboard

### Requirement: Corrections after check-in
Users SHALL be able to record items found or returned after check-in, which SHALL reduce the recorded loss and restore inventory, keeping a history of the correction.

#### Scenario: Late found headphones
- **WHEN** a user records 2 of 3 missing headphones as found
- **THEN** the booking shows 1 missing headphone, the proposed loss charge is reduced, and owned headphones increase by 2
