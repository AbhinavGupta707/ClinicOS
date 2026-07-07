# Checkpoint 04 - Dental Charting, Media, And Imaging Coexistence

## Goal

Doctor and assistant users can chart tooth-level dental findings, maintain dental chart history, attach photos/X-rays/documents to patient, encounter, tooth, and finding context, and view media through audited, permissioned signed-access flows.

## Base

- Branch: `main`
- Base commit before launch packet: `c7b222c`
- Launch date: 2026-07-07

## Scope

- Dental odontogram and tooth/surface finding model.
- Dental finding create/update flows with provenance, author, review state, history, timeline, audit, and outbox evidence.
- Dental chart snapshots/history for patient and encounter context.
- Media asset metadata, tags, attachment links, object-key privacy, signed access, upload completion, quarantine/scanning state, and PHI audit.
- X-ray/imaging coexistence by manual upload, external software reference/link, metadata import, and DICOM metadata preservation when fixtures are available.
- Web workflow for odontogram, tooth detail, media gallery, comparison view, and safe unavailable/deferred states.

## Non-Goals

- Treatment plans, estimates, checkout, payment, and printable instructions belong to Checkpoint 5.
- AI-generated dental chart patches belong to Checkpoint 8.
- Full PACS/DICOMweb adapter replacement is not required in CP4; coexistence comes first.
- Mobile chairside capture belongs to Checkpoint 8, though CP4 must expose backend/mobile-ready contracts.

## Lanes

| Lane              | Pending Worktree ID | Thread ID | Worktree | Ownership |
| ----------------- | ------------------- | --------- | -------- | --------- |
| Media Backend     | pending             | pending   | pending  | Media metadata, upload-url/complete-upload, signed URL mediation, storage abstraction/simulator, audit, permission tests, object-key privacy |
| Dental Domain     | pending             | pending   | pending  | Tooth numbering, dental findings, chart snapshots/history, treatment references, events, DB migration, domain/repository/API contracts |
| Dental/Media UX   | pending             | pending   | pending  | Odontogram, tooth detail panel, finding editor/history, media gallery/comparison, role-aware clinical surface, browser smoke |
| Imaging/QA        | pending             | pending   | pending  | X-ray coexistence fixtures, DICOM/external-link metadata fixtures, acceptance tests, E2E smoke plan, QA docs |

## Shared-File Policy

| Surface                         | Owner For CP4              | Rule |
| ------------------------------- | -------------------------- | ---- |
| `package-lock.json`             | Master integration         | Workers must not commit lockfile changes; request dependency changes in handoff. |
| Root `package.json`             | Master integration         | Workers request root scripts unless explicitly assigned. |
| DB migrations                   | Dental Domain              | Media Backend may request fields, but do not create competing CP4 migrations. |
| API contracts/generated clients | Dental Domain first        | Media Backend and UX consume documented contracts; do not invent durable route shapes independently. |
| `apps/api/**`                   | Dental Domain/Media Backend by endpoint | Coordinate route/schema changes; avoid duplicate parser helpers and route names. |
| `packages/security/**`          | Media Backend with master review | Audit actions and redaction must cover media and dental finding PHI. |
| `apps/web/**`                   | Dental/Media UX            | QA may add tests only; do not rewrite CP3 clinical workflow behavior unless CP4 requires extension. |
| Fixtures/test data              | Imaging/QA                 | Product runtime must not depend on fixtures outside explicit local/test fixture modes. |
| Docs/orchestration              | Master integration         | Workers provide handoff evidence; master records checkpoint evidence. |

## Required Verification

- Doctor/assistant can add and update findings by tooth number/surface with provenance and history.
- Dental chart history/snapshots are visible and linked to patient timeline.
- Media upload completion creates metadata without exposing raw bucket paths or object keys.
- Signed media access is short-lived, permissioned, tenant/clinic scoped, and audited.
- Media can attach to patient, encounter, tooth, and finding context.
- Accountant cannot view clinical media or dental findings by default.
- Wrong-tenant access is denied for dental chart and media.
- X-ray coexistence supports upload/import/link metadata without forcing replacement of external X-ray software.
- Browser smoke covers encounter -> dental finding -> media attach/view -> timeline at desktop and 390px mobile.

## Merge Order

1. Media Backend
2. Dental Domain
3. Dental/Media UX
4. Imaging/QA
5. Master integration patch on `codex/integration/checkpoint-4`
6. Verified promotion to `main`

## Exit Criteria

- CP4 workflows are complete for their intended scope without mock product behavior.
- Dental chart and media access are tenant/role scoped, auditable, and timeline-visible.
- Object storage paths remain private; user-visible access flows use mediated signed access only.
- Imaging coexistence is explicit and honest: upload/import/link, not forced PACS replacement.
- Full code checks, live local API smoke, and browser/user checks are recorded before merge.
