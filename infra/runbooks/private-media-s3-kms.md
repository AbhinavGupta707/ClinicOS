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
- `PrivateMediaAtomicPersistence` for transaction-bound state, immutable evidence, audit,
  operation deduplication, and durable reconciliation/outbox intent persistence.

Tests may use doubles behind those exact ports. Production composition must inject AWS SDK, durable Postgres/audit, and an approved scanner implementation. There is no product simulator or fallback inside the provider.

The provider state sequence is:

```text
reserved
  -> upload_verified (private + quarantined)
  -> scan_in_progress
  -> available          only from valid signed `clean` evidence
  -> quarantined        malicious/suspicious/integrity conflict
  -> scan_failed        timeout/provider/evidence failure; retry remains bounded
  -> delete_in_progress durable intent before S3 delete-marker reconciliation
  -> deleted            versioned delete marker, access denied
  -> restore_in_progress durable intent before exact-marker removal
  -> upload_verified    approved restore, mandatory rescan
  -> purge_in_progress  durable intent before governed version deletion
  -> purged             after retention/restore window and legal-hold check
```

The provider uses an unpredictable 256-bit internal suffix and binds tenant, clinic, media, upload, digest, byte count, and declared MIME type with HMAC-SHA-256. Filenames and patient identifiers are not copied into the terminal object name. Public results contain opaque media/upload IDs and signed capability URLs only; they never contain bucket, raw object key/path, KMS key, object/delete-marker version, provider token, or scanner signature. Signed URLs and required capability headers must never be logged.

Every signed capability is checked against the required `presignedEndpointAllowlist`. Configuration
accepts only exact HTTPS origins using these explicitly supported S3 forms for the configured bucket
and region: regional virtual-hosted, regional virtual-hosted dualstack, regional path-style, and
regional path-style dualstack. Returned URLs reject userinfo, fragments, non-default ports, and any
origin not in the configured subset. A valid header shape never compensates for an untrusted host.
The URL path must encode the exact internal key for the selected virtual-hosted/path-style endpoint;
GET must contain exactly one matching `versionId`, while PUT must not contain a version selector.

## Exact dependency set for master reconciliation

The lane did not edit manifests or the lockfile. The master must add these packages to `@clinic-os/integrations` for the production transport implementations, pin them to exact reviewed versions in the lockfile, and keep the AWS SDK v3 packages on one compatible release:

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `@aws-sdk/client-kms`
- `file-type`

No SQS dependency is required by the provider contract. Add `@aws-sdk/client-sqs` only if the selected scanner transport uses SQS rather than an S3 event/Lambda or managed scanning workflow. Do not add a dependency merely for a fixture.

The S3 transport must implement these official commands and expose retry-safe reconciliation
semantics for each deterministic operation ID:

- unversioned `HeadObject` only for initial completion discovery; version-bound `HeadObject` and
  `GetObject` with an explicit `VersionId` for every post-verification snapshot, restore check, and
  bounded byte range; `GetObjectTagging` and `ListMultipartUploads` for completion/incomplete-
  multipart checks;
- `PutObject` for the existing API-mediated upload fallback, with checksum, authority metadata, and quarantine tag bound;
- `DeleteObject` without a version to create the governed delete marker; the
  `ensureDeleteMarker` transport operation must first reconcile the recorded operation against the
  object's version history so a crash/retry cannot create an untracked sequence of markers;
- `DeleteObject` with the delete-marker version for restore;
- `DeleteObject` with the retained data version only after permanent-purge eligibility.

Scanner calls and every restore/purge transport call receive a deterministic operation ID (and
scanner intent ID). The scanner must use it as its provider idempotency/correlation key and bind the
operation ID into signed evidence. Purge derives separate deterministic `pmef_*` child effect IDs
for the retained object version and delete-marker version; the parent operation ID must never be
reused for both targets. Restore and purge transports treat repeated calls with the same effect ID
and immutable target as successful reconciliation and reject reuse for a different target.

The signer must use `PutObjectCommand`, `GetObjectCommand`, and `getSignedUrl`. The KMS evidence verifier must use `VerifyCommand` over the canonical scanner payload. `fileTypeFromBuffer` may supplement the built-in bounded detector; DICOM `DICM` preamble and ISO-BMFF brand checks must remain explicit.

## Master integration map

Integrate this lane without creating a second media route family:

1. Export `./media/index.js` from `packages/integrations/src/index.ts` and reconcile the four dependencies above in `packages/integrations/package.json` plus the root lockfile.
2. Add the official AWS SDK transport implementations under the lane-owned media namespace, inject initialized `S3Client`/`KMSClient` instances, and keep credentials on the workload role. Do not pass access keys through provider options.
3. Extend the canonical database migration once, using the existing media tables where coherent, to persist every `PrivateMediaRecord` field, optimistic `revision`, inspection lease, private version/delete-marker identifiers, legal-hold/restore state, and immutable evidence digest. Add forced RLS and tenant/clinic composite keys. Do not create an API-local or in-memory state store.
4. Implement one `PrivateMediaAtomicPersistence` adapter on the transaction-bound Postgres unit of
   work. `reserve` and every `transition` must commit the record mutation, immutable audit event,
   deterministic operation deduplication row, and durable reconciliation/outbox intent in one
   database transaction. `commitScanResult` must additionally append immutable signed evidence in
   that same transaction. An audit, evidence, intent, or persistence failure rolls back every part.
   Scanner/S3 effects remain outside that transaction and are reconciled by deterministic
   operation/intent IDs, expected revision, immutable digest, and idempotent transport behavior.
   Persist and validate `semanticFingerprintSha256`. Compute the canonical write fingerprint with
   the exported v1 helpers over operation semantics plus semantic state/evidence. Audit/intent and
   record timestamps are deliberately excluded, so a retry with regenerated `occurredAt`,
   `createdAt`, or `updatedAt` replays; actor, correlation, audit metadata, intent payload, scope,
   revisions, evidence, locator, or semantic state changes conflict. Never compare raw serialized
   request objects for replay identity.
5. In `apps/api/src/media-storage.ts`, add `mediaType` to `MediaUploadTargetInput` and pass it from the canonical CP13 handler. Production reservation must require a full SHA-256 digest. Add internal object version/checksum fields only if needed by server code; never add them to public DTOs.
6. In `apps/api/src/features/clinical-dental/media-handlers.ts`, pass the reserved `mediaType`, preserve tenant/clinic/patient relationship checks, and allow only the exact required signed upload headers: `content-type`, `content-length`, `x-amz-checksum-sha256`, `x-amz-meta-clinicos-binding`, and `x-amz-tagging`. Do not permit arbitrary `x-amz-meta-*` or caller-selected tagging.
7. In `apps/api/src/server.ts`, select `s3`/the approved scanner only after registration/config validation, construct one `S3PrivateMediaProvider`, and inject one `S3ClinicalMediaProvider` instance as both storage and inspection. Production-like startup must fail closed if the state/audit/scanner/KMS/S3 dependencies are absent. Keep the local pending simulator local-only.
   Supply the exact presigned endpoint origin subset and exact scanner signing-key ID allowlist;
   wildcard domains, arbitrary HTTPS origins, and runtime-derived caller hosts are forbidden.
8. Supply `RoutedMediaAuthorityFactory` from verified request context so every routed operation has
   the real actor and correlation ID. `S3ClinicalMediaProvider` refuses absent or service authority
   factories. `ServiceMediaAuthorityFactory` is explicit and permitted only for narrowly scoped
   background/reconciliation composition, never routed user calls.
9. Add lifecycle/delete/restore/legal-hold operations to the canonical runtime contracts and route inventory only once. Use `PrivateMediaLifecycleService`; do not add legacy aliases. Accept only the typed governed deletion/restoration reason codes. Explanatory protected text belongs in a separate authorized domain record and never in media audit/outbox. Public lifecycle receipts stay opaque and restore always returns to quarantine.
   Deletion codes are `retention_policy`, `patient_erasure_request`, `clinical_correction`,
   `security_response`, and `legal_disposition`. Restoration codes are `authorized_restore`,
   `clinical_correction`, `security_response`, and `legal_disposition`.
10. Regenerate OpenAPI/client artifacts and reconcile web/mobile upload helpers. Clients must calculate SHA-256 before reservation, send every signed required header exactly, and treat upload completion as pending/quarantined until scan evidence is clean.
11. Add readiness probes for the durable state store, bucket versioning/KMS policy, scanner activation, and evidence-verification key. Credential presence alone is `configured`, not `sandbox_verified` or `production_verified`.

## Durable state requirements

The canonical migration should extend/fold into `media_uploads`, `clinical_media_receipts`, and `media_assets` rather than introducing conflicting truth. It must durably represent at least:

- tenant, clinic, opaque media/upload identity, and private object locator;
- revision and provider state;
- deterministic pending operation ID for lifecycle effects prepared but not yet reconciled;
- kind, declared/detected MIME type, expected byte count and SHA-256;
- authority binding, object version identity digest, scan attempts and lease;
- delete-marker version, deleted/recoverable timestamps, and legal hold;
- immutable scanner evidence ID/digest, signed evidence payload, scanner/engine/definition version, scan time, and the current state pointer to that evidence;
- created/updated actor/time, audit/outbox linkage, and correction/supersession rather than evidence overwrite;
- immutable operation-deduplication and reconciliation/outbox rows with operation/intent ID,
  canonical semantic operation/write fingerprint,
  tenant/clinic/media/upload scope, expected/target revision, intent kind, safe payload, attempt
  state, claim lease, and terminal reconciliation result.

Required constraints include unique `(tenant_id, clinic_id, media_id, upload_id)`, globally unique
deterministic operation and intent IDs, forced RLS, positive bounded size/revision/attempt counts,
legal state transitions, unique evidence IDs within provider scope, append-only evidence/audit,
and denial of runtime updates/deletes to audit/evidence/operation history. An intent consumer must
claim with a bounded lease, retry safely, and make terminal success/failure visible for readiness
and incident reconciliation.

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
- evidence payload exactly bound to tenant, clinic, media/upload, deterministic scan operation,
  object identity/version, digest, size, detected MIME, verdict, engine/definitions, and scan time;
- evidence signed by the configured key and verified before transition; duplicate evidence is idempotent, conflicting evidence quarantines/fails, and timeouts remain unavailable;
- reject malformed envelopes before KMS verification: exact payload/signature fields only, known
  verdict, bounded identifiers, configured signing key, allowed algorithm, and strict bounded
  canonical base64 signature;
- malicious/suspicious samples use approved harmless test signatures (for example EICAR where policy permits) and synthetic media only.

## Operations

### Completion and inspection

1. Authorize tenant/clinic/patient/media relationship and reserve an opaque ID.
2. Calculate/require client SHA-256 and bounded declared size/type.
3. Atomically reserve state, immutable audit, and a deterministic reservation/outbox intent, then
   issue a PUT capability no longer than 10 minutes, bound to size/type/checksum/authority
   metadata/quarantine tag. The signed request must require exactly the five approved PUT headers;
   any additional signer-required header is a provider failure.
   Signer transport or validation failures append only a classified
   `media.upload_signing_failed` audit/outbox event; URLs and headers are never persisted.
   Provider-created validation errors remain specific and safe. Arbitrary SDK/transport errors are
   replaced with a generic retryable `provider_error` without the original cause, request, URL,
   headers, provider message, or stack text before they reach aggregate API logging.
4. On completion, head the authoritative version, reject incomplete multipart, validate size/type/checksum/metadata/tag/KMS/version, and range-read only the configured magic-byte budget.
5. Atomically persist `upload_verified`, its audit, and reconciliation intent; do not return read access.
6. Atomically claim a bounded scanner lease and durable execution intent before invoking the
   external scanner. Verify the signed payload, then atomically append immutable evidence, state
   transition, audit, operation deduplication, and result intent. A crash after the external scan is
   recovered by the execution intent and deterministic result operation ID.
7. Only `clean` becomes `available`. Malicious/suspicious, failed, timed-out, stale, invalid, or conflicting evidence remains unavailable.
8. API inspection snapshots use the pinned `objectVersionId` and revalidate size, type, checksum,
   authority metadata, quarantine tag, KMS key, and object-identity digest. A newer current version
   can never replace the scanned version in a completion result.

### Delete and restore

1. Check authorization, retention policy, clinical/legal obligations, and legal hold.
2. Atomically enter `delete_in_progress` with audit and deterministic S3 intent before creating or
   reconciling the versioned delete marker. Signed access is denied from this prepared state.
3. During the approved restore window, atomically enter `restore_in_progress`, remove only the
   recorded delete marker, verify the exact retained version/digest, atomically return state to
   quarantine, and rescan.
4. After the window, atomically enter `purge_in_progress`; a governed reconciliation operation
   deletes the recorded data version and marker with distinct child effect IDs before atomically
   confirming `purged`. Audit and provider evidence remain under separate required retention and
   never store a raw capability.
5. Every legal-hold change appends its dedicated immutable `media.legal_hold_changed` audit event
   in the same transaction as state and intent. Legal-hold mutation is rejected while delete,
   restore, or purge effects are in progress and after permanent purge.

### Incident response

- revoke signing/scanner roles and capability issuance before changing object policy;
- do not log, paste, ticket, or screenshot signed URLs, object keys, versions, bucket names tied to incidents, or evidence signatures;
- quarantine affected media IDs, preserve immutable audit/evidence, rotate the binding secret and scanner signing key through a versioned migration, and reconcile all in-flight reservations;
- a scanner outage removes media completion/access readiness but does not make uploads clean or available.

## Verification gates

Deterministic E1 tests in this lane cover scope denial, expiry, wrong size/type/digest/metadata/KMS,
magic mismatch, incomplete multipart, post-completion version tamper, quarantine,
clean/malicious/invalid/conflicting evidence, malformed envelope/signature rejection, timeout retry,
exact signed-header and endpoint-origin rejection, signer-failure audit, pinned post-scan API
snapshot behavior, atomic audit/evidence/persistence failure, canonical replay/conflict semantics,
concurrent scan and legal-hold/lifecycle races, dedicated legal-hold audit, governed reason codes,
purged hold denial, delete/restore/rescan/purge, distinct retry-safe purge child effects,
deterministic operation/outbox intent identity, and audit/intent redaction.

E4 activation additionally requires:

- applied bucket/KMS/IAM/network policy scans and a real versioned upload;
- expired PUT/GET denial and wrong-tenant denial through the deployed API;
- incomplete multipart cleanup, object/version tamper, wrong checksum/type/size, and safe malware sample evidence;
- scanner retry/DLQ/conflict and outage readiness behavior;
- legal-hold denial, delete marker, approved restore/rescan, lifecycle expiration, backup/replica reconciliation, and object restore drill;
- CloudTrail/audit/outbox reconciliation with no PHI or capability leakage;
- exact deployed revision/config, zero skips, synthetic data only, and named reviewer.

Do not close PRR-009 or claim CP14 completion from this source/runbook evidence. Applied resources, official scanner operation, alert delivery, and lifecycle/restore proof remain master-owned E4/E5 gates.
