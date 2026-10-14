# Spec Delta

## Purpose

Tracks the organizations and people the business sells to, and the progress of each sales opportunity from first contact to won or lost.

## ADDED Requirements

### Requirement: Organizations
The system SHALL let users create, view, edit, search, and archive organizations with a name, type (bar, venue, municipality, business, school, nonprofit, individual, other), city, address, website, phone, notes, and an optional competitor note.

#### Scenario: Create organization
- **WHEN** a user creates an organization named "Bar X" of type bar in Milwaukee
- **THEN** the organization appears in the organization list and can be found by searching "Bar X"

#### Scenario: Archived organizations are hidden by default
- **WHEN** a user archives an organization
- **THEN** it no longer appears in the default list but remains viewable with its history through an archived filter

### Requirement: Contacts
The system SHALL let users manage contacts with name, email, phone, role, and notes, each optionally linked to one organization.

#### Scenario: Contact linked to organization
- **WHEN** a user adds contact "Jordan" to organization "Bar X"
- **THEN** Jordan is listed on Bar X's detail page

### Requirement: Duplicate detection
The system SHALL warn the user when creating a contact whose email or phone matches an existing contact, or an organization whose name matches an existing organization in the same city.

#### Scenario: Duplicate contact email
- **WHEN** a user creates a contact with an email already used by another contact
- **THEN** the system shows the existing contact and lets the user open it or continue creating

### Requirement: Opportunity pipeline
The system SHALL track opportunities for an organization or contact through the stages New, Contacted, Quote Requested, Quoted, Won, and Lost, and SHALL show opportunities on a board grouped by stage.

#### Scenario: Move opportunity between stages
- **WHEN** a user moves an opportunity from Contacted to Quote Requested
- **THEN** the opportunity appears in the Quote Requested column and the change is recorded in its activity history

### Requirement: Loss reasons
The system SHALL require a loss reason when an opportunity is marked Lost, choosing from price, date unavailable due to capacity, chose competitor, event cancelled, no response, or other with a note.

#### Scenario: Marking lost for capacity
- **WHEN** a user marks an opportunity Lost with reason "date unavailable due to capacity"
- **THEN** the opportunity is closed and is counted in capacity-related losses

#### Scenario: Missing loss reason
- **WHEN** a user tries to mark an opportunity Lost without a reason
- **THEN** the system prevents the change and asks for a reason

### Requirement: Activity history
The system SHALL let users log notes, calls, emails, and meetings against organizations, contacts, opportunities, and bookings, and SHALL automatically log stage changes, quote events, and payment events.

#### Scenario: Manual note
- **WHEN** a user logs a call note on an opportunity
- **THEN** the note appears with author and timestamp in the opportunity's and its organization's activity timelines

#### Scenario: Automatic quote event
- **WHEN** a quote for an opportunity is accepted
- **THEN** an "accepted" entry appears in that opportunity's activity timeline
