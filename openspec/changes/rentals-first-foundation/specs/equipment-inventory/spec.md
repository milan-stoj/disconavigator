# Spec Delta

## Purpose

Records the equipment a silent disco business owns and the rental packages it sells, so availability, quotes, and loss tracking share one source of truth.

## ADDED Requirements

### Requirement: Equipment types
The system SHALL support equipment types that are tracked either as a pooled quantity (for example, headphones) or as individual serialized units (for example, transmitters). Each type SHALL have a name, tracking mode, and default replacement (loss) fee.

#### Scenario: Pooled type
- **WHEN** an admin views the headphones equipment type
- **THEN** it shows a total owned quantity and quantities in service and out of service

#### Scenario: Serialized type
- **WHEN** an admin views the transmitters equipment type
- **THEN** it lists each transmitter with its label or serial number and status

### Requirement: Adjusting owned quantities
Admins SHALL be able to add or remove pooled quantities and serialized units with a reason (purchase, retired, lost, damaged, found), and the system SHALL keep a history of these adjustments.

#### Scenario: Purchase more headphones
- **WHEN** an admin adds 50 headphones with reason "purchase"
- **THEN** total owned headphones increases from 100 to 150 and the adjustment appears in history

#### Scenario: Retire a transmitter
- **WHEN** an admin marks a transmitter retired
- **THEN** it no longer counts toward available capacity but remains in history

### Requirement: Out-of-service status
The system SHALL let users mark pooled quantities or serialized units out of service (for example, charging failure or repair) and SHALL exclude them from available capacity until returned to service.

#### Scenario: Headphones in repair
- **WHEN** a user marks 5 headphones out of service
- **THEN** available headphone capacity on every date is reduced by 5 until they are returned to service

### Requirement: Rental package catalog
Admins SHALL be able to define rental packages with a name, description, price, included equipment quantities, included rental days, per-extra-day price, and per-item loss fees. Admins SHALL be able to deactivate packages.

#### Scenario: Define package
- **WHEN** an admin creates "Party 50" with 50 headphones, 1 transmitter, 2 included days, price $300, and a $60 headphone loss fee
- **THEN** the package can be added to rental quotes and its loss fees apply to bookings using it

#### Scenario: Deactivated package
- **WHEN** an admin deactivates a package
- **THEN** it can no longer be added to new quotes but existing quotes and bookings keep it
