# Private Clinical Media — S3, KMS, Inspection, and Lifecycle

**Scope:** CP14 private-media provider implementation and activation prerequisites

**Evidence posture:** source and deterministic contract evidence only until the master applies and verifies E4 AWS resources

**Production rule:** no patient-supplied object becomes accessible without authoritative completion verification and signed clean scanner evidence

## Architecture

`S3PrivateMediaProvider` owns the security state machine. It depends only on typed production ports:

- `S3PrivateObjectTransport` for version-aware S3 head/range/put/delete/restore operations;
- `S3PresigningTransport` for least-method, short-lived PUT and GET capabilities;
- `MagicByteDetector` for bounded content identification;
- `MalwareScannerTransport` plus `MalwareEvidenceSignatureVerifier` for scan evidence;
- `PrivateMediaStateStore` and `MalwareEvidenceStore` for optimistic, tenant-scoped durable state;
- `PrivateMediaAuditSink` for append-only product audit evidence.

Tests may use doubles behind those exact ports. Production composition must inject AWS SDK, durable Postgres/audit, and an approved scanner implementation. There is no product simulator or fallback inside the provider.

The provider state sequence is:

```text
reserved
  -> upload_verified (private + quarantined)
  -> scan_in_progress
  -> available          only from valid signed `clean` evidence
  -> quarantined        malicious/suspicious/integrity conflict
  -> scan_failed        timeout/provider/evidence failure; retry remains bounded
  -> deleted            versioned delete marker, access denied
  -> upload_verified    approved restore, mandatory rescan
  -> purged             after retention/restore window and legal-hold check
```

The provider uses an unpredictable 256-bit internal suffix and binds tenant, clinic, media, upload, digest, byte count, and declared MIME type with HMAC-SHA-256. Filenames and patient identifiers are not copied into the terminal object name. Public results contain opaque media/upload IDs and signed capability URLs only; they never contain bucket, raw object key/path, KMS key, object/delete-marker version, provider token, or scanner signature. Signed URLs and required capability headers must never be logged.

## Exact dependency set for master reconciliation

The lane did not edit manifests or the lockfile. The master must add these packages to `@clinic-os/integrations` for the production transport implementations, pin them to exact reviewed versions in the lockfile, and keep the AWS SDK v3 packages on one compatible release:

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `@aws-sdk/client-kms`
- `file-type`

No SQS dependency is required by the provider contract. Add `@aws-sdk/client-sqs` only if the selected scanner transport uses SQS rather than an S3 event/Lambda or managed scanning workflow. Do not add a dependency merely for a fixture.

The S3 transport must implement these official commands:

- `HeadObject`, `GetObject` with a bounded byte range, `GetObjectTagging`, and `ListMultipartUploads` for completion/incomplete-multipart checks;
- `PutObject` for the existing API-mediated upload fallback, with checksum, authority metadata, and quarantine tag bound;
- `DeleteObject` without a version to create the governed delete marker;
- `DeleteObject` with the delete-marker version for restore;
- `DeleteObject` with the retained data version only after permanent-purge eligibility.

The signer must use `PutObjectCommand`, `GetObjectCommand`, and `getSignedUrl`. The KMS evidence verifier must use `VerifyCommand` over the canonical scanner payload. `fileTypeFromBuffer` may supplement the built-in bounded detector; DICOM `DICM` preamble and ISO-BMFF brand checks must remain explicit.

## Master integration map

Integrate this lane without creating a second media route family:

1. Export `./media/index.js` from `packages/integrations/src/index.ts` and reconcile the four dependencies above in `packages/integrations/package.json` plus the root lockfile.
2. Add the official AWS SDK transport implementations under the lane-owned media namespace, inject initialized `S3Client`/`KMSClient` instances, and keep credentials on the workload role. Do not pass access keys through provider options.
3. Extend the canonical database migration once, using the existing media tables where coherent, to persist every `PrivateMediaRecord` field, optimistic `revision`, inspection lease, private version/delete-marker identifiers, legal-hold/restore state, and immutable evidence digest. Add forced RLS and tenant/clinic composite keys. Do not create an API-local or in-memory state store.
4. Implement `PrivateMediaStateStore`, `MalwareEvidenceStore`, and `PrivateMediaAuditSink` on the transaction-bound Postgres unit of work. State transition, required audit, and outbox/reconciliation evidence must commit together. The scanner/S3 side effect is reconciled by immutable digest and idempotency, not by pretending it is database-atomic.
5. In `apps/api/src/media-storage.ts`, add `mediaType` to `MediaUploadTargetInput` and pass it from the canonical CP13 handler. Production reservation must require a full SHA-256 digest. Add internal object version/checksum fields only if needed by server code; never add them to public DTOs.
6. In `apps/api/src/features/clinical-dental/media-handlers.ts`, pass the reserved `mediaType`, preserve tenant/clinic/patient relationship checks, and allow only the exact required signed upload headers: `content-type`, `content-length`, `x-amz-checksum-sha256`, `x-amz-meta-clinicos-binding`, and `x-amz-tagging`. Do not permit arbitrary `x-amz-meta-*` or caller-selected tagging.
7. In `apps/api/src/server.ts`, select `s3`/the approved scanner only after registration/config validation, construct one `S3PrivateMediaProvider`, and inject one `S3ClinicalMediaProvider` instance as both storage and inspection. Production-like startup must fail closed if the state/audit/scanner/KMS/S3 dependencies are absent. Keep the local pending simulator local-only.
8. Supply an authority factory from the verified request context so provider audit contains the real actor and correlation ID. The adapter's service-actor default is for master composition/bootstrap only; it must not replace human attribution at routed operations.
9. Add lifecycle/delete/restore/legal-hold operations to the canonical runtime contracts and route inventory only once. Use `PrivateMediaLifecycleService`; do not add legacy aliases. Public lifecycle receipts stay opaque and restore always returns to quarantine.
10. Regenerate OpenAPI/client artifacts and reconcile web/mobile upload helpers. Clients must calculate SHA-256 before reservation, send every signed required header exactly, and treat upload completion as pending/quarantined until scan evidence is clean.
11. Add readiness probes for the durable state store, bucket versioning/KMS policy, scanner activation, and evidence-verification key. Credential presence alone is `configured`, not `sandbox_verified` or `production_verified`.

## Durable state requirements

The canonical migration should extend/fold into `media_uploads`, `clinical_media_receipts`, and `media_assets` rather than introducing conflicting truth. It must durably represent at least:

- tenant, clinic, opaque media/upload identity, and private object locator;
- revision and provider state;
- kind, declared/detected MIME type, expected byte count and SHA-256;
- authority binding, object version identity digest, scan attempts and lease;
- delete-marker version, deleted/recoverable timestamps, and legal hold;
- immutable scanner evidence ID/digest, signed evidence payload, scanner/engine/definition version, scan time, and the current state pointer to that evidence;
- created/updated actor/time, audit/outbox linkage, and correction/supersession rather than evidence overwrite.

Required constraints include unique `(tenant_id, clinic_id, media_id, upload_id)`, forced RLS, positive bounded size/revision/attempt counts, legal state transitions, unique evidence IDs within provider scope, append-only evidence, and denial of runtime updates/deletes to audit/evidence history.

## AWS prerequisites

No AWS resource or mutation was performed by this lane. Before activation, Terraform and applied evidence must provide:

### S3

- private bucket in `ap-south-1`, all public access blocks enabled, bucket-owner-enforced ownership, versioning enabled, and deletion protection/governed teardown;
- default SSE-KMS using the dedicated media CMK and S3 Bucket Keys where approved;
- policy denying non-TLS requests, public principals, ACL changes, unapproved encryption overrides, writes outside the environment prefix, and requests not originating from approved workload roles/endpoints;
- lifecycle for abandoned multipart uploads, quarantined/failed objects, non-current versions, recoverable delete markers, and approved permanent disposition;
- exact-origin CORS for PUT/GET and only the five upload headers listed above;
- S3 data-event audit, access anomaly alerts, replication/backup policy, and cross-region recovery posture approved for the data class.

### KMS

- one symmetric CMK for media encryption with rotation, alias, separation of administration/use, and grants restricted by `kms:ViaService` and encryption context;
- a separate asymmetric signing key (or equally approved signing service) for scanner evidence;
- scanner permission to sign only the evidence workflow, API permission to verify, and neither role permission to administer/disable/schedule deletion;
- alarms/review for decrypt, sign, verify, policy, grant, disable, and deletion-schedule activity.

### IAM/network

- API signing/verification role limited to the environment prefix and required S3 head/range/tag/multipart/sign/delete-marker operations;
- scanner role limited to quarantined versions, required KMS decrypt/sign use, evidence write, and scan result tagging/state publication;
- no `s3:*`, `kms:*`, wildcard resource, static key, public bucket endpoint dependency, or worker access to unrelated tenant data;
- private S3/KMS VPC endpoints and restrictive endpoint policies where the workload network uses them.

### Scanner

- approved engine/service, update and outage policy, maximum object/time budgets, reserved concurrency/backpressure, DLQ/reconciliation, and alerts;
- evidence payload exactly bound to tenant, clinic, media/upload, object identity/version, digest, size, detected MIME, verdict, engine/definitions, and scan time;
- evidence signed by the configured key and verified before transition; duplicate evidence is idempotent, conflicting evidence quarantines/fails, and timeouts remain unavailable;
- malicious/suspicious samples use approved harmless test signatures (for example EICAR where policy permits) and synthetic media only.

## Operations

### Completion and inspection

1. Authorize tenant/clinic/patient/media relationship and reserve an opaque ID.
2. Calculate/require client SHA-256 and bounded declared size/type.
3. Issue a PUT capability no longer than 10 minutes, bound to size/type/checksum/authority metadata/quarantine tag.
4. On completion, head the authoritative version, reject incomplete multipart, validate size/type/checksum/metadata/tag/KMS/version, and range-read only the configured magic-byte budget.
5. Persist `upload_verified`; do not return read access.
6. Claim a bounded scanner lease. Verify the signed payload and append immutable evidence.
7. Only `clean` becomes `available`. Malicious/suspicious, failed, timed-out, stale, invalid, or conflicting evidence remains unavailable.

### Delete and restore

1. Check authorization, retention policy, clinical/legal obligations, and legal hold.
2. Create a versioned delete marker and deny all new signed access from product state.
3. During the approved restore window, remove only the recorded delete marker, verify the exact retained version/digest, return state to quarantine, and rescan.
4. After the window, a governed purge deletes the recorded data version and marker. Audit/provider evidence remains under its separate required retention and never stores the raw object capability.

### Incident response

- revoke signing/scanner roles and capability issuance before changing object policy;
- do not log, paste, ticket, or screenshot signed URLs, object keys, versions, bucket names tied to incidents, or evidence signatures;
- quarantine affected media IDs, preserve immutable audit/evidence, rotate the binding secret and scanner signing key through a versioned migration, and reconcile all in-flight reservations;
- a scanner outage removes media completion/access readiness but does not make uploads clean or available.

## Verification gates

Deterministic E1 tests in this lane cover scope denial, expiry, wrong size/type/digest/metadata/KMS, magic mismatch, incomplete multipart, post-completion version tamper, quarantine, clean/malicious/invalid/conflicting evidence, timeout retry, signed access, legal hold, delete/restore/rescan/purge, and audit redaction.

E4 activation additionally requires:

- applied bucket/KMS/IAM/network policy scans and a real versioned upload;
- expired PUT/GET denial and wrong-tenant denial through the deployed API;
- incomplete multipart cleanup, object/version tamper, wrong checksum/type/size, and safe malware sample evidence;
- scanner retry/DLQ/conflict and outage readiness behavior;
- legal-hold denial, delete marker, approved restore/rescan, lifecycle expiration, backup/replica reconciliation, and object restore drill;
- CloudTrail/audit/outbox reconciliation with no PHI or capability leakage;
- exact deployed revision/config, zero skips, synthetic data only, and named reviewer.

Do not close PRR-009 or claim CP14 completion from this source/runbook evidence. Applied resources, official scanner operation, alert delivery, and lifecycle/restore proof remain master-owned E4/E5 gates.
