# Spec Delta

## Purpose

Lets prospective customers request a quote through a public form so every inquiry is captured as a lead for manual pricing.

## ADDED Requirements

### Requirement: Public quote request form
The system SHALL provide a public, unauthenticated, mobile-friendly form where a visitor submits name, email, phone, organization (optional), service interest (equipment rental or full-service event), event date, expected attendance, event location, and message.

#### Scenario: Valid submission
- **WHEN** a visitor submits the form with all required fields
- **THEN** the system confirms receipt to the visitor and records the request

#### Scenario: Invalid submission
- **WHEN** a visitor submits the form with a missing email or an event date in the past
- **THEN** the system shows field-level errors and does not record the request

### Requirement: Request creates lead
The system SHALL turn each accepted quote request into an opportunity in the Quote Requested stage, linked to a matching existing contact by email when one exists, or to a newly created contact and organization otherwise.

#### Scenario: New requester
- **WHEN** a request arrives from an email not on any contact
- **THEN** a new contact, an organization if one was named, and a Quote Requested opportunity are created

#### Scenario: Returning requester
- **WHEN** a request arrives from an email matching an existing contact
- **THEN** a new Quote Requested opportunity is linked to that existing contact

### Requirement: Staff notification
The system SHALL notify the tenant's users of each new quote request through an in-app indicator and an email to a configured address.

#### Scenario: New request notification
- **WHEN** a quote request is recorded
- **THEN** the dashboard shows it as new and an email with the request details is sent to the configured notification address

### Requirement: Abuse protection
The system SHALL limit form submissions per client within a time window and SHALL reject submissions that fail spam checks, without revealing which check failed.

#### Scenario: Rate limit exceeded
- **WHEN** one client submits more requests than the configured limit within the window
- **THEN** further submissions are rejected until the window passes

#### Scenario: Spam submission
- **WHEN** a submission fills the hidden spam-trap field
- **THEN** the system shows the normal confirmation but does not record the request
