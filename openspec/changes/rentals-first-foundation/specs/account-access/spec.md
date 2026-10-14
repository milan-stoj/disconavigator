# Spec Delta

## Purpose

Controls who can use Disco Controller and isolates each silent disco business's data within its own tenant.

## ADDED Requirements

### Requirement: Tenant data isolation
The system SHALL associate every business record with exactly one tenant and SHALL only expose records belonging to the authenticated user's tenant.

#### Scenario: User reads only own tenant data
- **WHEN** a user of tenant A requests a list of organizations
- **THEN** the system returns only organizations belonging to tenant A

#### Scenario: Cross-tenant access is rejected
- **WHEN** a user of tenant A requests a record that belongs to tenant B by its identifier
- **THEN** the system responds as if the record does not exist

### Requirement: User authentication
The system SHALL require users to sign in with a username and password before accessing any non-public page or API, and SHALL store passwords only as salted one-way hashes.

#### Scenario: Successful sign-in
- **WHEN** a user submits a valid username and password
- **THEN** the system starts an authenticated session and shows the dashboard

#### Scenario: Failed sign-in
- **WHEN** a user submits an incorrect password
- **THEN** the system rejects the sign-in with a generic error that does not reveal whether the username exists

#### Scenario: Unauthenticated access
- **WHEN** an unauthenticated visitor requests an internal page or API
- **THEN** the system denies access and directs the visitor to sign in

### Requirement: Sign-out and session expiry
The system SHALL let users sign out and SHALL expire idle sessions after a configurable period.

#### Scenario: User signs out
- **WHEN** a signed-in user chooses to sign out
- **THEN** the session is invalidated and later requests with it are unauthenticated

### Requirement: User roles
The system SHALL support an admin role that can manage users, settings, inventory, and packages, and a staff role that can work with leads, quotes, bookings, and check-in/out but cannot manage users or settings.

#### Scenario: Staff cannot manage users
- **WHEN** a staff user attempts to create another user
- **THEN** the system denies the action

#### Scenario: Admin creates staff user
- **WHEN** an admin creates a user with the staff role
- **THEN** the new user can sign in and access staff features within the same tenant

### Requirement: Initial tenant seeding
On first run against an empty database, the system SHALL create the tenant "Undercover Dance Party", admin user "kali", and an inventory of 100 headphones and 3 transmitters. The admin password SHALL come from deployment configuration or a first-run setup step, never from source code.

#### Scenario: First run seeds the initial business
- **WHEN** the application starts against an empty database with an initial admin password configured
- **THEN** the tenant, admin user "kali", 100 headphones, and 3 transmitters exist and kali can sign in with the configured password

#### Scenario: Seeding is not repeated
- **WHEN** the application restarts against a database that already contains the tenant
- **THEN** no duplicate tenant, user, or inventory is created

#### Scenario: Missing initial password
- **WHEN** the application starts against an empty database without an initial admin password configured
- **THEN** the system requires the admin password to be set through a first-run setup step before the admin account can be used
