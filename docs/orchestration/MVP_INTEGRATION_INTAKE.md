# MVP Source Integration Intake

Status: Ray and Profile identified; owner confirms export access and knows the
edition (2026-09-22); edition value, export schema and samples still pending

Data policy: attach only synthetic or de-identified samples unless separately approved

This document freezes the source contract for MVP1. Connector-specific code must
not begin from assumptions; every required field below needs evidence or an
explicitly approved fallback.

## Clinic and source

- Clinic name or non-sensitive identifier: Healthy Roots Family Dental Studio,
  Girgaon (owner supplied; clinic confirmation pending)
- Clinic country/timezone: India; expected `Asia/Kolkata` (clinic confirmation
  pending)
- Source software/vendor: Practo (owner supplied)
- Product edition/version: owner confirms Practo Ray plus Practo Profile;
  on 2026-09-22 the owner confirmed the edition is known and will provide it;
  the actual edition/version value remains pending
- Clinic contact who can verify source behavior: pending
- Expected patient count: pending
- Expected practitioner count: pending
- Expected appointment count per day/month: pending

## Authorized access

Choose one and attach the relevant documentation:

- [ ] official read API
- [ ] official scheduled export
- [ ] clinic-authorized CSV/XLS export
- [ ] explicit manual handoff
- [ ] other official/authorized mechanism

Recommended initial route: a clinic-authorized Practo Ray export-to-email of
Contacts and Appointments, followed by an import-once dry run. The clinic uses
Ray; the owner confirmed authorized export access on 2026-09-22. The resulting
file format, columns and representative de-identified samples remain unverified.

Required details:

- Documentation URL or supplied document:
  - https://help.practo.com/practo-ray/settings/understanding-the-settings-of-your-practo-ray-account/
  - https://help.practo.com/partner-api/practo-api-program-terms-and-conditions/
  - https://help.practo.com/practo-ray/settings/how-do-i-sync-my-calendar-to-other-calendar-apps/
- Sandbox/test account available: not applicable to the manual-export route;
  no Ray clinic-data API sandbox is publicly documented
- Authentication method: clinic staff use their own authorized Ray account;
  ClinicOS must not receive or store the staff member's Ray password
- Rate/pagination limits: not applicable to the manual-export route; unknown for
  any future Practo-authorized API
- Export generation procedure: in Ray Settings, open `Import/Export data`, select
  `Contact` and `Appointments`, enter a clinic-controlled correspondence email,
  and use `Export to email`
- File encoding/delimiter/workbook sheets: pending
- Access authorization confirmed by: owner; export access confirmed in conversation
- Date confirmed: 2026-09-22; sample handoff and data-handling conditions remain pending

## Research-backed access decision

- Practo's official Ray help states that Ray can export Contact, Treatment,
  Expenses, and Appointments data to email at any time.
- Practo's public API programme is contract-gated and describes searching,
  booking, and managing appointments across Practo's OPD network. Public terms do
  not establish an API for exporting this clinic's private Ray patient database.
- Ray documents per-doctor calendar subscription links. These may help with
  appointment freshness later, but are insufficient as the primary source for
  patient identity, practitioner mapping, status reconciliation, and replay.
- No public official documentation was found for Ray patient/appointment
  webhooks or scheduled clinic-data exports. Practo support must confirm whether
  either capability is available to this clinic's account.
- Therefore MVP1 must start with the official manual export, not undocumented
  endpoints, browser automation, reverse engineering, or scraping. A recurring
  operator-triggered export remains an acceptable MVP2 fallback if Practo does
  not offer an authorized clinic-data API.

## Representative de-identified samples

Store approved fixtures under a vendor-specific test-fixture path, never in this
document.

- Patient sample path: pending
- Practitioner sample path: pending; if Ray supplies no staff export, obtain a
  clinic-prepared list of active practitioners and their Ray display names
- Appointment sample path: pending
- At least one changed appointment sample: pending
- At least one cancellation/no-show sample: pending
- At least one malformed or incomplete row sample: pending
- Sample de-identification confirmed by: pending

## Identity and field semantics

- Stable external patient identifier: pending
- Stable external practitioner identifier: pending
- Stable external appointment identifier: pending
- Whether identifiers can be reused: pending
- Patient duplicate signals available: pending
- Practitioner-to-ClinicOS user mapping rule: pending
- Appointment start/end/timezone semantics: pending
- Appointment status vocabulary: pending
- Cancellation/deletion semantics: pending
- Last-updated timestamp or change cursor: pending
- Missing record meaning (deleted, filtered, or unknown): pending
- Source-of-truth owner for each field: pending

## Trial mode

- Initial mode: import-once recommended; clinic confirmation pending
- Desired cadence: pending
- Maximum acceptable data staleness: pending
- Read-only confirmed: yes for the owner-approved MVP programme
- Writeback explicitly excluded for MVP1: yes
- Success window and clinic trial date: pending

## Acceptance dataset counts

Record expected counts before running the first import:

| Entity/state | Source count | Expected ClinicOS result |
| --- | ---: | --- |
| Patients | pending | pending |
| Practitioners | pending | pending |
| Appointments | pending | pending |
| Cancellations/no-shows | pending | pending |
| Known duplicates | pending | pending |
| Known invalid rows | pending | pending |

## Decisions and sign-off

- Unverified source behavior and chosen conservative fallback: use clinic-run Ray
  exports; do not assume API access, scheduled export, webhook semantics, or
  undocumented columns
- Fields intentionally not imported: Treatment and Expenses remain outside MVP1
  unless a verified identity field required for patient/appointment linkage is
  available only in the Treatment export
- Known data-quality limitations: pending
- Owner approval to begin MVP1: programme approved; source-independent coding is
  active, while the Practo-specific parser/mapping remains gated on clinic
  authorization, authoritative documentation, and de-identified samples
- Approval date: pending
