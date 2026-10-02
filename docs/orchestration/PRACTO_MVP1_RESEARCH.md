# Practo MVP1 Integration Research

Status: account and export route verified; owner received a ZIP of patient and
appointment CSVs and supplied headers/date/status representations on 2026-09-26.
Appointment IDs, planned duration, raw CSV format and repeat-export semantics
remain unresolved. API entitlement remains unverified.

Date: 2026-08-30

Official documentation rechecked: 2026-09-26

Pilot: Healthy Roots- A Family Dental Studio, Sector 50, Gurgaon, Haryana
(account observed and owner reconfirmed 2026-09-26; supersedes earlier Girgaon references)

Source confirmed by owner: Practo Ray and Practo Profile

## 26 September export receipt and field semantics

Following the initial read-only inspection below, the owner authorized a Patients
and Appointments export to the registered clinic owner's mailbox. Ray reported
PENDING, then COMPLETED; the owner received a ZIP with `patients.csv` (21 columns)
and `appointments.csv` (8 columns). Headers and non-identifying date/status
representations were supplied in chat; the agent has not opened the real files.

The [dated mapping decision and offline profile instructions](PRACTO_EXPORT_MAPPING_2026-09-26.md)
are the current detailed source contract. Date is reported as
`YYYY-MM-DD HH:mm:ss`, with surrounding apostrophes; observed status labels are
Scheduled and Cancelled. No appointment ID, scheduled end/duration, or visit type
is present. Check-in/out are attendance workflow timestamps, not substitutes for
scheduled duration. Public documentation does not verify the raw CSV encoding or
these timestamp fields' serialization. Recurring reconciliation remains gated on
durable identity, reschedule/cancellation semantics and a second snapshot.

A local aggregate-only profile utility and synthetic safety tests are now
available. It never imports records or reports migration readiness. Export
generation authorization does not authorize the agent to inspect real files or
load patient records into ClinicOS. These facts supersede the earlier pending
container/header/export-execution questions while retaining their dated history.

## 26 September authenticated account review

During the initial inspection, the owner authorized read-only access through the
existing logged-in Chrome session and confirmed the Gurgaon dental account as
the pilot. At that stage no export was submitted, data downloaded, individual
patient record opened, setting saved, message sent, integration activated or
subscription changed. The subsequent authorized export is recorded above.

Account facts observed:

- Current Ray plan: **Ray-Prime-Essentials**. This is a plan name, not an exact
  application build/version.
- Practice timezone: **Asia/Kolkata**.
- One active doctor/owner and one separate active Frontdesk account.
- Automatic patient number generation is on. Exported IDs and their stability
  still require workbook evidence.
- The calendar uses 30-minute display slots and has a location-like appointment
  category. Neither establishes clinical visit type, chair or appointment duration.
- Storage reports 269.2 MB of stored files; that is not total database size.

The actual route is **Settings → Import Export Data → Request Import / Export →
Export**. The dialog says it exports Ray data **to Excel** and sends it to the
registered practice owner's email. It lists Patients, Appointments, Treatments,
Procedure Catalog, Prescriptions, Clinical Notes, Files, Billing, Treatment Plans
and Expenses. All structured categories are selected by default, while Files is
not. Requesting only Patients and Appointments would require narrowing that
selection. The inspected form did not expose a headers-only option or a
patient/appointment date filter. No request was submitted.

The Integrations page exposes Practo's own product integrations, including Drive
record sharing; no general clinic-data API or scheduled export control was found
on the inspected screen. Do not infer unavailable private capabilities from that
absence, or treat record sharing as a ClinicOS connector.

This initial inspection superseded older unverified account/edition/export-UI
statements below. At that point the format, columns, identifiers, statuses and
repeated-export semantics were unverified; the later owner-supplied evidence is
recorded above. Historical export rows displaying 0.00 B and
today's date for old requests must not be used as record-count or completeness
evidence. No patient names, rows, contact details, credentials or calendar-feed
tokens have been added to these notes.

Observed account URLs: [Practice Details](https://ray.practo.com/settings/clinicdetails),
[Practice Staff](https://ray.practo.com/settings/managestaff),
[Export settings](https://ray.practo.com/settings/importexport),
[Integrations](https://ray.practo.com/integrations), and
[Subscriptions](https://store.practo.com/home).

## 22 September clarification and documentation recheck

The owner clarified that the currently known account detail is the staff login
hostname `ray.practo.com`, and deferred obtaining export/version details. This
supersedes an earlier same-day answer suggesting those details were confirmed.
The hostname does not establish edition, export permissions, API entitlement or
the file schema. An unauthenticated fetch of that host returned HTTP 403; no
login, private endpoint discovery or clinic account access was attempted.

The [official settings guide](https://help.practo.com/practo-ray/settings/understanding-the-settings-of-your-practo-ray-account/)
still documents selecting Contact and Appointments under Import/Export data and
requesting delivery to a clinic-controlled mailbox. The page is tagged **Ray v6**;
it is a documented candidate workflow, not verification of the clinic's current
screen. It does not publish the export columns, stable appointment identifiers,
file format or update/cancellation contract. Other Ray report formats must not
be substituted for that missing schema. Using the clinic's existing mailbox for
this manual handoff does not require building email integration into ClinicOS.

The [public partner API terms](https://help.practo.com/partner-api/practo-api-program-terms-and-conditions/)
describe contract-gated OPD search/booking services, not a generally available
private Ray database API. The [calendar subscription guide](https://help.practo.com/practo-ray/settings/how-do-i-sync-my-calendar-to-other-calendar-apps/)
documents doctor-specific links but does not specify the identity or reconciliation
contract needed by ClinicOS. Neither changes the import-first decision.

When the clinic is ready, verify the export option with an authorized account
administrator or Practo support, then inspect headers or an approved de-identified
sample. It is unnecessary to guess the Ray edition now. Until that evidence
arrives, continue source-independent identity and workflow work, and keep the
Practo adapter and sync status explicitly unavailable.

## Decision in one sentence

Use a clinic-run Practo Ray export of Patients and Appointments for the first
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
| Does the clinic use Practo Ray? | Yes; authenticated account inspection confirms Ray-Prime-Essentials | Exact application build/version is still unknown |
| Can Ray export patients and appointments? | Both are offered in this account's official export request UI | Actual request/delivery not performed; requires separate authorization |
| What file format and columns are produced? | The dialog declares Excel; exact workbook format and columns are unknown | Deidentified export or header-only workbook |
| Does the export contain stable patient and appointment IDs? | Unknown | Sample columns and two repeated exports |
| Can active practitioners be exported? | Not established; one active doctor/owner is visible in Practice Staff | Exported doctor field/ID, historical doctors and clinic-approved mapping |
| Is there a clinic-data API or webhook? | No public official evidence found | Written Practo confirmation, agreement, and documentation |
| Can exports be scheduled? | No public official evidence found | Written Practo or account-level confirmation |
| Can calendar subscriptions replace exports? | No; insufficient evidence for identity and reconciliation | Use only as an optional later freshness aid after inspecting the feed |

Absence of public documentation is not proof that a private feature does not
exist. It means ClinicOS must not claim or implement that capability until Practo
and the clinic provide authoritative evidence.

## Recommended MVP route

### MVP1: import once

1. Use the verified Ray-Prime-Essentials account for the owner-confirmed Gurgaon
   pilot. This plan name does not establish the workbook schema or exact build.
2. With separate export authorization, the clinic administrator requests only
   `Patients` and `Appointments`; the current form delivers to the registered
   practice owner's email address.
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

## Questions still open after the export receipt

1. What are the actual CSV encoding, delimiter, escaping, birthdate format,
   check-in/out representation and aggregate data-quality counts? Container and
   header names are now owner-confirmed; see the dated mapping decision.
2. Can the appointment export be restricted by date range through an official
   route? No such field was visible in the inspected default form.
3. The owner sees Scheduled and Cancelled only. How does this export represent
   reschedules, no-shows and completed attendance, if at all? Do not infer outcomes.
4. Is Patient Number stable and unique across exports? Can a supported export
   supply stable appointment/practitioner IDs and planned duration/end?
5. What does omission from a later export mean: deleted, cancelled, outside the
   date range, or unknown?
6. Is the clinic willing to run the export manually for the pilot, and at what
   cadence?

## Practo support request template

Subject: Authorized read-only integration options for our Practo Ray clinic data

> We operate Healthy Roots- A Family Dental Studio in Sector 50, Gurgaon and use
> Ray-Prime-Essentials. We are evaluating an owner-authorized, read-only integration
> with our internal ClinicOS pilot. Please confirm whether Practo offers a documented clinic-data
> API, webhook, or scheduled export for our own patients, practitioners, and
> appointments. If not, please confirm the supported Contact and Appointment
> export fields, stable identifiers, date filters, cancellation and reschedule
> semantics, and whether practitioner/staff data can be exported. Our received
> appointments.csv has Date, Patient Number, Patient Name, Notes, DoctorName,
> Status, Checked In At and Checked Out At. How can we obtain stable appointment
> IDs and planned end times/durations through an official route? Please also
> confirm the Date timezone and check-in/check-out timestamp encoding and triggers.
> We will not scrape or reverse engineer Practo and will begin with deidentified
> data only.

The clinic should send this request from its registered account email. No Practo
password, API secret, export containing real patient data, or email attachment
should be forwarded to the ClinicOS repository.

## Coding gate and orchestration decision

Source-specific implementation begins only after the sample schema or an
authoritative clinic-data API contract is confirmed. Source-independent work may
continue in the existing canonical migration, external-link, dashboard, search,
and provider-health boundaries; it must not encode guessed Practo fields.

Once the schema is frozen, MVP1 should remain one sequential master lane through
adapter contract, parser, normalization, identity, and staging design. A bounded
review subagent may independently verify the mapping and acceptance tests.
Worktrees are not justified until stable contracts create genuinely independent
backend and UI/reconciliation lanes.
