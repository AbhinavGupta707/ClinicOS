# Post-merge pilot development — 22 September 2026

The owner authorized continued development after PR #1 merged into
`mac-latest-20260829` at `dbea53653fdc2a4317f6a00e3578114d71692aff`.
The merged tree matches tested source `202cd4dae86ebd86178f213add544ec7172e7247`.
`main` was not promoted. This is a development baseline, not clinic deployment
or production approval.

## Current owner decisions

- Email integration is deferred. Do not make email provider selection or an
  email account a prerequisite for the current implementation work. A future
  production onboarding/recovery design must still state what it supports.
- “Muse” referred to a possible WhatsApp intermediary, not speech-to-text.
  Its exact product is unconfirmed and no dependency is selected. Continue with
  the existing official Meta WhatsApp boundary; evaluate an intermediary only
  if a concrete clinic requirement justifies it. Do not add a second transport,
  QR-session automation, or a Muse speech provider on that assumption.
- Keep Keycloak as the existing identity provider. Complete its application
  integration before considering a replacement; Clerk is not an additional
  requirement or an approved migration.
- Preserve the accepted visual system. Prioritize working clinic tasks and
  readable patient/appointment context over a new visual redesign.

The [MVP execution plan](MVP_EXECUTION_PLAN.md) remains authoritative. Its first
product proof is authorized patient/practitioner/appointment import, Today,
patient lookup and repeatable reconciliation. Live AI, broad provider coverage
and enterprise deployment remain later scope. The [cloud deferral](CHECKPOINT_14_CLOUD_DEFERRAL_DECISION.md)
still applies; this record does not authorize AWS/DNS activation or service
start/reset/recreation. Desktop stays read-only.

## First implementation: durable login transactions

The web's `Cp14BffRuntime`, `OAuthTransactionManager`, `WebSessionManager`,
`RedisWebSessionStore`, official Keycloak token client and API identity edge
already exist. The production `OAuthTransactionStore` did not. The only store
implementation available to the login transaction manager was a test double.

`RedisOAuthTransactionStore` fills that specific gap: encrypted PKCE transaction
records, atomic create with absolute expiry, one destructive consume across web
processes, key rotation, bounded operations, safe diagnostics and dependency
readiness. Unit/fault tests are separate from the explicit real-Redis integration
gate in the quality workflow. No routes are activated by this change.

This is a completed storage adapter, **not completed staff sign-in**. Keep the
existing unavailable state until the entire web lifecycle is composed and tested.
Neither a provider key nor a passing Keycloak protocol smoke closes that gap.

## Next implementation sequence

1. **Authoritative identity and audit composition.** Bind verified issuer plus
   subject to current tenant/user/membership/clinic/role state and a stable
   authority revision. The existing subject-only repository must not become a
   cross-issuer identity shortcut. Complete the global pre-membership security
   audit sink, Redis audit dispatcher, readiness and recovery contract. Existing
   Redis sessions already retain required audit intents atomically; do not
   rebuild them or substitute diagnostic logs for the durable sink.
2. **The complete web sign-in/session slice.** Bind server-only keys and the
   confidential client, reviewed MFA policy, stores, authority resolver, trusted
   request boundary and bounded API transport. Register login, callback, session,
   logout and allowlisted BFF routes together. Change browser API calls to the
   opaque-cookie/CSRF contract; do not expose access/refresh tokens to JavaScript.
   Verify login, denial, expiry, refresh, logout, revocation, role changes and
   mobile/browser recovery. Production proxy trust remains unavailable until
   connection/forwarding provenance is proven.
3. **The pilot source contract and daily workflow.** Use the actual authorized
   Ray export to implement verified field mapping and representative import.
   Prove a second cycle, changed/cancelled records, replay and recovery before
   claiming sync. Refine Today/readability and patient handoff from real task
   observations. Do not infer source freshness from UI load time.
4. **One official communication workflow.** When the owner reopens the required
   HTTPS deployment and provider activation, verify direct Meta sandbox setup,
   consent/templates, signed callbacks and delivery/retry behavior before the
   first clinic reminder. No extra WhatsApp intermediary is required by current
   code. Email remains deferred.
5. **Consultation recording and reviewed drafts.** Scope and evaluate the full
   consent → recording → transcription → draft → doctor review/sign-off flow.
   The existing Fireworks file transcription client has no production route
   caller and disables speaker separation; do not present it as live consultation
   capture. No Muse transcription work follows from the owner's clarification.

These are incremental development PRs against the merged development baseline.
They do not retroactively close CP14–CP18 external evidence or production gates.

## Clinic input that still matters

Healthy Roots and Practo Ray/Profile are already identified. The remaining
source-specific inputs are the Ray edition value, representative
de-identified Contacts/Appointments files, practitioner mapping, timezone and
update/cancellation meanings. Record them in the [existing intake](MVP_INTEGRATION_INTAKE.md).
On 2026-09-22 the owner confirmed authorized export access and that the edition
is known; the actual details and samples have not yet been supplied.
No connector-specific parser should guess the format. No live patient data,
passwords or API keys are needed to continue the bounded identity implementation.

## Evidence boundaries

The storage adapter tests do not prove Next.js route registration, application
login, MFA, deployed Redis failover/restore, authoritative audit dispatch, live
provider traffic or clinic approval. The real-Redis test uses only its randomly
namespaced synthetic records; it does not start a service, flush a database or
modify existing records. Local checks use existing dependencies on Spectra.
