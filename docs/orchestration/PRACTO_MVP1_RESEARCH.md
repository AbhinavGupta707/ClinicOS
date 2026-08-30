# Practo MVP1 Integration Research

Status: discovery complete; implementation awaits clinic confirmation and samples

Date: 2026-08-30

Pilot: Healthy Roots Family Dental Studio, Girgaon

Source named by owner: Practo

## Decision in one sentence

Use a clinic-run Practo Ray export of Contacts and Appointments for the first
read-only import; do not build against the Practo partner API, private browser
traffic, or assumed Ray endpoints without a separate written Practo agreement and
verified technical documentation.

## Confirmed official facts

1. Practo Ray is Practo's clinic-management product and includes patient records,
   practitioners, appointments, billing, and reports.
2. Ray's official settings documentation says a clinic can export four categories
   to a chosen email address at any time: Contact, Treatment, Expenses, and
   Appointments.
3. Ray can generate patient IDs, but whether this clinic enabled them and whether
   they are included in an export is not documented publicly.
4. Ray provides per-doctor calendar subscription links for Google Calendar,
   Outlook, and iCal. The public documentation does not define the event schema,
   stable identifiers, cancellation behavior, refresh guarantees, or patient
   identity coverage.
5. Practo's public API programme requires a commercial agreement. Its published
   scope is Practo's OPD network for searching, booking, and managing physical OPD
   appointments. It does not publicly establish access to a clinic's private Ray
   patient database.
6. Practo lists `support@practo.com` as the provider-support channel.

Official sources:

- https://www.practo.com/providers/clinics/ray
- https://help.practo.com/practo-ray/settings/understanding-the-settings-of-your-practo-ray-account/
- https://help.practo.com/practo-ray/settings/how-do-i-sync-my-calendar-to-other-calendar-apps/
- https://help.practo.com/partner-api/practo-api-program-terms-and-conditions/
- https://help.practo.com/practo-ray/reports/reports-on-appointments/
- https://www.practo.com/company/security

## Truth versus assumption

| Question | Current truth | Required evidence |
| --- | --- | --- |
| Does the clinic use Practo Ray? | Unknown; the owner said Practo | Clinic opens the operational product and confirms its name/version |
| Can Ray export contacts and appointments? | Yes, officially documented | Confirm the option exists for this account and plan |
| What file format and columns are produced? | Unknown | Deidentified export or header-only file |
| Does the export contain stable patient and appointment IDs? | Unknown | Sample columns and two repeated exports |
| Can active practitioners be exported? | Not publicly documented | Staff export, appointment doctor field, or clinic-prepared mapping |
| Is there a clinic-data API or webhook? | No public official evidence found | Written Practo confirmation, agreement, and documentation |
| Can exports be scheduled? | No public official evidence found | Written Practo or account-level confirmation |
| Can calendar subscriptions replace exports? | No; insufficient evidence for identity and reconciliation | Use only as an optional later freshness aid after inspecting the feed |

Absence of public documentation is not proof that a private feature does not
exist. It means ClinicOS must not claim or implement that capability until Practo
and the clinic provide authoritative evidence.

## Recommended MVP route

### MVP1: import once

1. The clinic confirms that the operational product is Practo Ray and records the
   visible edition/version.
2. An authorized clinic administrator exports `Contact` and `Appointments` from
   Ray to a clinic-controlled email address.
3. The clinic creates a deidentified representative copy that preserves column
   names, data types, relationships, status values, and edge cases.
4. The clinic supplies a small active-practitioner mapping if the exports do not
   contain a stable practitioner identifier.
5. ClinicOS runs a dry-run parser and reconciliation report before any record is
   committed.
6. The exact same input is replayed to prove idempotency and zero duplicate domain
   records.

### MVP2: repeatable operation

Start with an operator-triggered recurring export and import. This is less elegant
than an API, but it is official, authorized, observable, and enough to validate
whether ClinicOS provides daily value. In parallel, ask Practo whether this clinic
can access a documented read-only API, webhook, or scheduled export. Upgrade only
after the contract and payload semantics are verified.

## Required sample pack

No real patient data or clinic credentials belong in Git or in an ordinary chat.
The clinic should provide:

- a header-preserving Contact export with roughly 20-50 deidentified rows;
- an Appointment export covering the same patients and all active practitioners;
- at least one future appointment, completed visit, cancellation, no-show,
  reschedule/update, duplicate candidate, and malformed/incomplete row;
- a second export representing a later point in time so update and missing-record
  semantics can be measured;
- the total source counts for each export before deidentification;
- a practitioner mapping containing the Ray display value and a clinic-approved
  ClinicOS display name or neutral test name.

Deidentification must preserve cross-file relationships while replacing patient
names, phone numbers, emails, addresses, dates of birth, free text, and source IDs
with consistent synthetic values. If the clinic cannot do this safely, first send
only the column headers and data-type descriptions; ClinicOS can generate a
synthetic fixture template for the clinic to validate.

## Questions the clinic must answer

1. When staff manage the daily calendar, does the product visibly say `Practo
   Ray`, and what version or edition is shown?
2. Does `Settings > Import/Export data` exist, and can the clinic select Contact
   and Appointments?
3. What format arrives by email: CSV, XLS, XLSX, ZIP, or another format?
4. Can the appointment export be filtered by date range?
5. Which values represent booked, confirmed, arrived, engaged, completed,
   cancelled, rescheduled, and no-show?
6. Are patient, practitioner, and appointment IDs present and stable across two
   exports?
7. What does omission from a later export mean: deleted, cancelled, outside the
   date range, or unknown?
8. Is the clinic willing to run the export manually for the pilot, and at what
   cadence?

## Practo support request template

Subject: Authorized read-only integration options for our Practo Ray clinic data

> We operate Healthy Roots Family Dental Studio in Girgaon and use Practo for our
> clinic operations. We are evaluating an owner-authorized, read-only integration
> with our internal ClinicOS pilot. Please confirm whether our account is Practo
> Ray and its edition/version, and whether Practo offers a documented clinic-data
> API, webhook, or scheduled export for our own patients, practitioners, and
> appointments. If not, please confirm the supported Contact and Appointment
> export formats, available fields, stable identifiers, date filters, cancellation
> and reschedule semantics, and whether practitioner/staff data can be exported.
> We will not scrape or reverse engineer Practo and will begin with deidentified
> data only.

The clinic should send this request from its registered account email. No Practo
password, API secret, export containing real patient data, or email attachment
should be forwarded to the ClinicOS repository.

## Coding gate and orchestration decision

Source-specific implementation begins only after the product and sample schema are
confirmed. Until then, generic connector code would encode guesses and risk a
parallel architecture.

Once the schema is frozen, MVP1 should remain one sequential master lane through
adapter contract, parser, normalization, identity, and staging design. A bounded
review subagent may independently verify the mapping and acceptance tests.
Worktrees are not justified until stable contracts create genuinely independent
backend and UI/reconciliation lanes.
