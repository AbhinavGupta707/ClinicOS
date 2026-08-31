# Modern Dental Atelier

Status: accepted Option C concept and implemented MVP visual system.

These images were generated with the built-in Codex Image Gen workflow. They are design references, not evidence that the depicted patient records, appointment counts, provider connections, or data freshness exist in the runtime.

## Product system

- Mineral-white canvas, dark evergreen tonal navigation, near-black ink.
- Eucalyptus interaction accent, pale mineral-blue information surfaces, restrained clay attention states.
- Contemporary sans-serif UI with serif date, patient-name, and section-title moments.
- Fine rules and open operational lists instead of a dashboard card grid.
- Functional 8–12 px radii, little or no shadow, rounded outline icons at 1.75 stroke.
- Desktop sidebar and mobile five-item bottom navigation.
- Operator copy leads with the task and keeps engineering detail under progressive disclosure.

## Accepted concepts

- [Today overview](./today-overview.png)
- [Today selected appointment](./today-selected-appointment.png)
- [Patients](./patients.png)
- [Import clinic data](./import-clinic-data.png)
- [Today mobile](./today-mobile.png)

## Fidelity ledger

| Design point        | Implemented evidence                                                                                                                        | Decision                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Tonal shell         | Evergreen grouped navigation, mineral canvas, slim clinic top bar                                                                           | Matched                                            |
| Editorial hierarchy | Serif clinic date, patient names, and import title with compact sans-serif operations copy                                                  | Matched                                            |
| Operational density | Open schedule rows plus a restrained Practice pulse rail                                                                                    | Matched using only durable runtime fields          |
| Patient workspace   | Search/results rail, identity header, operational panels, and one-click clinical-profile handoff                                            | Matched; selection stays in memory and out of URLs |
| Manual import       | Patient → practitioner → appointment guide, file-first dropzone, paste tab, preflight rail, review, commit, rollback, and collapsed history | Matched and simplified for clinic operators        |
| Mobile              | Wrapped action header, compact appointment rows, selected-state details, and fixed bottom navigation                                        | Matched within real 390 × 844 constraints          |

## Intentional deviations

- The concept says “Data refreshed just now.” The implementation says “Clinic session active” globally and shows exact load/update timestamps on Today. This avoids claiming data freshness that the shell has not measured.
- Concept patient and appointment examples are illustrative. Runtime screens render only API/Postgres records and show honest empty states.
- The import page explicitly says “No Practo connection,” “Scheduled sync: Not configured,” and “Source freshness: Unknown.” It does not imply an API connection or write-back.
- The implementation retains explicit conflict review, commit, and best-effort rollback gates even though most technical detail is visually collapsed.
- ClinicOS exposes more existing navigation surfaces than the concept; they inherit the system without being falsely presented as redesigned MVP workflows.

## Verification

Validated against the accepted concepts at 1440 × 1024 and 390 × 844 with Playwright Chromium. Checks included page identity, meaningful content, framework-error absence, console/page errors, file/paste interaction, patient search and profile handoff, selected appointment state, real Postgres import/commit/rollback, and horizontal overflow.

Quality gates:

- Web typecheck
- Web lint
- 110 web tests
- Production Next.js build
- Four real-stack Playwright acceptance tests
