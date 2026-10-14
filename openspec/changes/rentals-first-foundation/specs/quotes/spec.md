# Spec Delta

## Purpose

Lets staff price every booking manually and lets customers review and accept quotes online, distinguishing equipment rentals from full-service events that the business runs.

## ADDED Requirements

### Requirement: Booking types
Each quote SHALL have one booking type: equipment rental (the customer rents equipment and runs the event) or full-service event (the business provides DJs and runs the event). Each quote SHALL also have its dates, location, and expected attendance, and SHALL belong to an opportunity.

#### Scenario: Create equipment rental quote
- **WHEN** a user creates an equipment rental quote from a Quote Requested opportunity with rental dates Friday to Sunday
- **THEN** the quote is saved as a draft equipment rental linked to that opportunity with those dates

#### Scenario: Create full-service quote
- **WHEN** a user creates a full-service event quote for a bar on a Saturday night
- **THEN** the quote is saved as a draft full-service event with that event date

### Requirement: Equipment rental pricing
Equipment rental quotes SHALL be priced as a fixed total built from line items. Users SHALL be able to add a rental package, which adds its price and reserves its equipment, plus custom add-ons such as extra headphones or extra days, each with quantity and price.

#### Scenario: Add a package with an add-on
- **WHEN** a user adds the package "Party 50" priced $300 and an extra-day add-on of $75 to an equipment rental quote
- **THEN** the quote total is $375 and the quote requires the package's 50 headphones and 1 transmitter

### Requirement: Full-service pricing terms
Full-service event quotes SHALL use one pricing term: flat fee from line items, door split (a percentage of door revenue collected by the venue), or guarantee plus split (the greater of a guaranteed amount and a percentage of door revenue). They SHALL record required equipment.

#### Scenario: Flat fee total
- **WHEN** a user sets a full-service quote to a flat fee with one $800 line item
- **THEN** the quote total is $800

#### Scenario: Door split has no fixed total
- **WHEN** a user sets a full-service quote to a 40% door split with no guarantee
- **THEN** the quote shows the split terms and that the final amount is determined after the event

#### Scenario: Guarantee plus split
- **WHEN** a user sets a guarantee of $500 plus a 40% door split
- **THEN** the quote shows a minimum of $500 and that the final amount is the greater of $500 and 40% of the door

#### Scenario: Split terms unavailable for rentals
- **WHEN** a user edits an equipment rental quote
- **THEN** door split and guarantee plus split are not offered as pricing terms

### Requirement: Delivery fee
For equipment rentals delivered outside the service area (Milwaukee or Madison metro by default), the quote SHALL add a delivery fee line with a configurable suggested amount that the user can override.

#### Scenario: Rental outside service area
- **WHEN** a user marks an equipment rental's delivery location as outside the service area
- **THEN** a delivery fee line with the configured suggested amount is added and remains editable

#### Scenario: Rental inside service area
- **WHEN** an equipment rental's location is marked inside the Milwaukee or Madison metro
- **THEN** no delivery fee line is added

### Requirement: Holding deposit for equipment rentals
Equipment rental quotes SHALL show a holding deposit equal to a configurable percentage of the total (default 20%) and the remaining balance. Full-service event quotes SHALL NOT require a holding deposit.

#### Scenario: Rental deposit
- **WHEN** an equipment rental quote totals $1,000
- **THEN** the holding deposit is $200 and the remaining balance is $800

#### Scenario: No deposit for full-service
- **WHEN** a full-service flat-fee quote totals $1,000
- **THEN** the quote shows no holding deposit and a total of $1,000

### Requirement: Recurring event series
The system SHALL let a user create one full-service quote covering a recurring series of events (for example, the first Friday of each month for six months) and SHALL list each occurrence date with its own availability status.

#### Scenario: Monthly series
- **WHEN** a user creates a series quote for the first Friday of each month from January to June
- **THEN** the quote lists six occurrence dates and flags any date that is unavailable

### Requirement: Availability check on quotes
The system SHALL check every quote date against the availability calendar and SHALL warn, without blocking, when required headphones, transmitters, or staff exceed what is available.

#### Scenario: Insufficient headphones
- **WHEN** a quote requires 80 headphones on a date where 40 are already committed
- **THEN** the quote shows a capacity warning for that date

### Requirement: Sending quotes
The system SHALL let a user send a quote, which gives it a unique, hard-to-guess public link and an expiry date, emails the link to the contact, and moves the opportunity to Quoted.

#### Scenario: Send quote
- **WHEN** a user sends a draft quote
- **THEN** the contact receives an email with the quote link, the quote status becomes Sent, and the opportunity moves to Quoted

### Requirement: Quote revisions
Editing a sent quote SHALL create a new revision, invalidate the previous public link, and keep earlier revisions viewable internally.

#### Scenario: Revise sent quote
- **WHEN** a user edits the price of a sent quote and resends it
- **THEN** the old link shows the quote is no longer valid and the new link shows the revised price

### Requirement: Customer acceptance
The public quote page SHALL show the booking type, line items or pricing terms, any holding deposit, and the tenant's terms for that booking type. Customers SHALL accept by agreeing to the terms and typing their full name, and the system SHALL record revision, name, timestamp, and IP address.

#### Scenario: Customer accepts quote
- **WHEN** a customer agrees to the terms, types their name, and submits on a valid quote link
- **THEN** the quote becomes Accepted, an acceptance record is stored, and a booking of the quote's type is created

#### Scenario: Rental terms shown
- **WHEN** a customer opens an equipment rental quote
- **THEN** the page shows the equipment rental terms, including the holding deposit and loss and damage fees

#### Scenario: Expired quote
- **WHEN** a customer opens a quote link after its expiry date
- **THEN** the page shows the quote has expired and acceptance is not possible

### Requirement: Declining quotes
Customers SHALL be able to decline a quote from the public page, and users SHALL be able to mark a quote declined. Either way the opportunity SHALL prompt for a loss reason.

#### Scenario: Customer declines
- **WHEN** a customer declines a quote from the public page
- **THEN** the quote status becomes Declined and the opportunity is flagged for the user to record a loss reason
