# Checkpoint 4 QA Fixtures And Smoke Contracts

This QA pack belongs to the Checkpoint 4 dental charting, media, and imaging coexistence slice.

It is local/test-only. Product runtime must not depend on these fixtures outside explicit local/test fixture modes.

## Fixture

Canonical scenario:

```text
fixtures/synthetic/cp4/dental_chart_media_imaging_flow.json
```

The scenario covers:

- Encounter context, tooth 16 occlusal finding creation, doctor review, and dental chart snapshot/history.
- Manual X-ray upload initialization, upload completion, media metadata, quarantine/scanning state, and signed-access view.
- Metadata-only DICOM import fixture with study, series, instance, modality, body part, acquisition time, and tooth hints.
- External X-ray software reference linking through a clinic-approved manual workflow.
- Media attachments to patient, encounter, tooth, and dental finding context.
- PHI-sensitive audit expectations and patient timeline entries for dental finding, chart snapshot, media, DICOM metadata, external link, and signed media view events.
- Accountant and wrong-tenant denial contracts for dental chart access, signed media access, and media linking.
- Object-key and raw storage path privacy expectations for public API responses.

## Fixture Schema

The top-level fixture shape is:

```text
schemaVersion
fixtureUse
sourceReferences
clock
tenants
clinics
actors
patients
appointments
encounters
dentalCharts
dentalFindings
dentalChartSnapshots
mediaAssets
mediaAttachments
imagingStudies
dicomMetadataFixtures
externalMediaLinks
flow
roleTenantExpectations
responseAssertions
e2eSelectorContract
```

Guardrails enforced by `scripts/validate-cp4-fixtures.mjs`:

- `fixtureUse.localOnly`, `syntheticOnly`, and `productionUseDenied` must be true.
- Allowed environments are only `local`, `development`, `test`, and `ci`.
- Emails must use `.example.test`.
- Patient phones must use the reserved CP4 fixture range `+91994000####`.
- IDs must be deterministic v4-style UUIDs.
- Dental charting must use FDI tooth numbering in this fixture.
- Sensitive flow steps must declare audit entries with PHI field names.
- Required CP4 events and timeline entries must be present.
- Accountant and wrong-tenant denials must cover dental chart and clinical media access.
- Media responses must assert absence of `objectKey`, `rawStoragePath`, `bucket`, and `storagePath`.
- The fixture must not contain real provider storage URLs or raw storage paths.

## Local Validation

These checks require only Node after the repository is available:

```sh
node scripts/validate-cp4-fixtures.mjs
node --test tests/acceptance/*.test.mjs
node scripts/cp4-contract-smoke.mjs --dry-run
```

Targeted CP4 acceptance:

```sh
node --test tests/acceptance/cp4-fixture-contract.test.mjs
```

## API Smoke After Integration

After Media Backend, Dental Domain, Dental/Media UX, and Imaging/QA lane outputs are integrated, run:

```sh
node scripts/cp4-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Required bearer-token env for live API smoke:

```text
CLINICOS_CP4_OWNER_TOKEN=...
CLINICOS_CP4_DOCTOR_TOKEN=...
CLINICOS_CP4_ASSISTANT_TOKEN=...
CLINICOS_CP4_RECEPTIONIST_TOKEN=...
CLINICOS_CP4_ACCOUNTANT_TOKEN=...
CLINICOS_CP4_WRONG_TENANT_ASSISTANT_TOKEN=...
```

For an explicitly local-only auth adapter, the smoke also supports:

```sh
CLINICOS_CP4_AUTH_MODE=fixture-headers node scripts/cp4-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Only use `fixture-headers` for local/test builds that intentionally register a fixture auth adapter. Do not enable it in production.

Optional audit probe:

```text
CLINICOS_CP4_AUDIT_API_PATH=/v1/audit/events?correlationId=cp4
```

If no audit read API is merged in CP4, verify audit rows through backend/security repository or DB tests and record that evidence in the orchestration checkpoint log.

## Endpoint Assumptions

The smoke plan currently assumes these CP4 endpoint contracts:

```text
GET /v1/encounters/{encounterId}
POST /v1/encounters/{encounterId}/dental-findings
PATCH /v1/dental-findings/{findingId}
POST /v1/patients/{patientId}/dental-chart/snapshots
POST /v1/patients/{patientId}/media/upload-url
POST /v1/media-assets/{mediaAssetId}/complete-upload
POST /v1/patients/{patientId}/imaging/dicom-metadata
POST /v1/patients/{patientId}/external-media-links
POST /v1/media-assets/{mediaAssetId}/links
POST /v1/media-assets/{mediaAssetId}/signed-access
GET /v1/patients/{patientId}/timeline
GET /v1/patients/{patientId}/dental-chart
GET /v1/media-assets/{mediaAssetId}
GET /v1/patients/{patientId}/imaging-studies/{imagingStudyId}
```

Backend may return generated IDs rather than fixture IDs. If so, the master integration smoke should add a runtime ID map after each creation response before executing downstream requests. Do not hard-code production-generated IDs into product code.

Public media responses must not expose raw storage internals. The smoke asserts absence of these fields where relevant:

```text
objectKey
rawStoragePath
bucket
storagePath
```

## Web E2E After Integration

For local synthetic browser smoke, start the web app with the CP4 workflow fixture and doctor role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3000
```

Then run:

```sh
CLINICOS_CP4_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npm exec playwright -- test tests/e2e/checkpoint-4-dental-media-flow.spec.ts
```

For role denial smoke, start a separate fixture server with the accountant role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3001

CLINICOS_CP4_ROLE_DENIAL_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 \
npm exec playwright -- test tests/e2e/checkpoint-4-dental-media-flow.spec.ts --grep "dental/media role denial"
```

The integrated E2E spec expects the CP4 route and stable selectors below:

```text
/surface/clinical?scenario=cp4-dental-chart-media
cp4-dental-media-workspace
cp4-fixture-alert
cp4-encounter-context
cp4-odontogram
cp4-tooth-16
cp4-finding-editor
cp4-create-finding
cp4-finding-history
cp4-chart-snapshots
cp4-media-gallery
cp4-request-upload
cp4-complete-upload
cp4-import-dicom-metadata
cp4-link-external-xray
cp4-attach-media-to-finding
cp4-request-signed-view
cp4-signed-media-viewer
cp4-storage-privacy-guard
cp4-media-comparison
cp4-patient-timeline
cp4-clinical-access-denied
```

If the frontend lane chooses different selectors, update only the fixture selector contract/spec during integration; keep the workflow assertions intact.

## Local Simulator Evidence

This lane provides deterministic local/test simulator evidence only:

- Metadata-only DICOM fixture preserves useful DICOM metadata without adding a DICOM binary or real radiograph.
- X-ray coexistence is represented through manual upload, metadata import, and external software reference linking.
- External software reference is explicit manual metadata and does not scrape, automate, or replace external X-ray software.
- Media quarantine/scanning is represented as a local fixture state (`scan_passed`) behind the expected media provider contract.
- Signed access is asserted at contract level: mediated signed URL, short TTL, audit event, and no object key/raw storage path in public expectations.

## Live Provider Gaps

These are integration or later-checkpoint verification items, not product behavior implemented by this QA fixture lane:

- Real object storage signed URL generation must be verified by the Media Backend lane and master integration smoke.
- Real malware scanning/quarantine provider evidence is not included; CP4 fixture checks the state contract only.
- No live PACS, DICOMweb, or X-ray workstation adapter is included in CP4. The accepted CP4 posture is coexistence first: manual upload, clinic-approved import, and explicit external reference/link metadata.
- No unauthorized browser automation or scraping of external imaging software is allowed.
- Browser E2E cannot pass until the Dental/Media UX lane exposes the CP4 route/selectors and local fixture activation flag.

## Requested Root Scripts

The QA lane did not edit root `package.json`. Suggested scripts for the master integration patch:

```json
{
  "cp4:fixtures:validate": "node scripts/validate-cp4-fixtures.mjs",
  "cp4:acceptance": "node --test tests/acceptance/*.test.mjs",
  "cp4:smoke:api:dry-run": "node scripts/cp4-contract-smoke.mjs --dry-run",
  "cp4:smoke:api": "node scripts/cp4-contract-smoke.mjs",
  "cp4:e2e": "playwright test tests/e2e/checkpoint-4-dental-media-flow.spec.ts"
}
```
