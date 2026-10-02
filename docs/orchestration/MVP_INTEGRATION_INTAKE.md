# MVP Source Integration Intake

Status: authenticated account inspection and owner-authorized Patients/Appointments
export completed on 2026-09-26. Owner received a ZIP containing patients.csv and
appointments.csv and supplied headers/date/status formats. Gurgaon is the pilot.
Raw file inspection, representative synthetic wire samples, appointment identity,
planned duration and API entitlement remain unverified. See
[the dated mapping decision](PRACTO_EXPORT_MAPPING_2026-09-26.md).

Data policy: attach only synthetic or de-identified samples unless separately approved

This document freezes the source contract for MVP1. Connector-specific code must
not begin from assumptions; every required field below needs evidence or an
explicitly approved fallback.

## Clinic and source

- Clinic name or non-sensitive identifier: Healthy Roots- A Family Dental Studio,
  Sector 50, Gurgaon, Haryana (account observed and owner reconfirmed 2026-09-26;
  corrects the earlier Girgaon reference)
- Clinic country/timezone: India; `Asia/Kolkata` selected in the account settings
- Source software/vendor: Practo (owner supplied)
- Product edition/version: Ray-Prime-Essentials is the visible current Ray plan;
  exact application build/version remains unknown. Practo Profile was previously
  identified by the owner.
- Clinic contact who can verify source behavior: pending
- Expected patient count: pending
- Expected practitioner count: one active doctor/owner shown in Practice Staff;
  historical practitioner references in exports remain to be checked. A separate
  active Frontdesk account also exists.
- Expected appointment count per day/month: pending

## Authorized access

Choose one and attach the relevant documentation:

- [ ] official read API
- [ ] official scheduled export
- [x] clinic-authorized CSV/XLS export
- [ ] explicit manual handoff
- [ ] other official/authorized mechanism

Initial route: owner-authorized Practo Ray export-to-email of Patients and
Appointments, completed. Owner reports a ZIP of two CSVs despite the UI's Excel
label. Column names and limited scalar formats have been provided, not raw files.
Next: aggregate-only local profiling and a synthetic import fixture contract.
The actual UI differs from the older Ray v6 public guide; follow
the dated authenticated findings in `PRACTO_MVP1_RESEARCH.md`. Receiving the file
in the owner's existing mailbox does not require ClinicOS email integration.

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
- Export generation procedure observed: Settings → Import Export Data → Request
  Import / Export → Export. Select only Patients and Appointments (other
  structured categories are checked by default), then Request Export. The form
  says delivery goes to the registered practice owner's email, with no arbitrary
  recipient field visible. Owner authorized this action after the initial
  read-only inspection; request reached COMPLETED and owner confirmed receipt.
- Export scope controls: no headers-only option or patient/appointment date
  filter was visible in the inspected form; do not promise a bounded source export.
- File encoding/delimiter: unverified from original bytes; ZIP contains patients.csv
  and appointments.csv. Exact reported headers are in the dated mapping decision.
- Access authorization confirmed by: owner authorized account inspection and
  export to the registered owner mailbox; no agent access to real files or
  real patient import is authorized. Only headers/format examples were supplied.
- Date confirmed: account/plan/export UI observed and pilot location confirmed 2026-09-26

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

- Stable external patient identifier: Patient Number present; automatic patient
  number generation is on. Uniqueness, completeness, reuse and stability pending.
- Stable external practitioner identifier: absent from reported headers; DoctorName
  needs explicit mapping to existing eligible ClinicOS doctors.
- Stable external appointment identifier: absent from reported headers; do not
  substitute row number or a hash of patient/doctor/time and claim durable identity.
- Whether identifiers can be reused: pending
- Patient duplicate signals available: pending
- Practitioner-to-ClinicOS user mapping rule: pending
- Appointment start/end/timezone semantics: clinic timezone Asia/Kolkata verified;
  Date reported as apostrophe-wrapped YYYY-MM-DD HH:mm:ss. Confirm export timezone
  against a scheduled booking. Planned duration/end absent. Check-in/out are
  attendance events with unverified encoding/accuracy, not scheduled duration.
  Calendar slot size and location-like category must not substitute for duration/type.
- Appointment status vocabulary: owner reports apostrophe-wrapped Scheduled and
  Cancelled; scheduled is not proof of confirmation, completed attendance or no-show.
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
- Known data-quality limitations: no appointment ID, planned duration/end or visit
  type; doctor names only; missing/reused patient IDs, phone completeness and
  timestamp encoding require local profiling. Never infer precise DOB from Age.
- Owner approval to begin MVP1: programme approved; source-independent coding is
  active, while the Practo-specific parser/mapping remains gated on clinic
  authorization, authoritative documentation, and de-identified samples
- Approval date: pending
