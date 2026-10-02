# Provider dispatch and security hardening

Status: implemented; local acceptance passed, exact-head remote review required. Base `52dddeb8e14f35436cc6bec438299b03315e17d3`
(merged PR #12), branch `codex/provider-security-hardening`. The integration-first
MVP remains authoritative; live activation and production release remain NO-GO.

## Outcome and scope

Make the existing clinical instruction request -> durable action -> official
WhatsApp sender path work safely under actual PostgreSQL permissions. Resolve or
explicitly classify all 19 open CodeQL findings from the prior branch. This is a
safety repair, not a new campaign, AI, onboarding or provider activation feature.

Parent owns all source writes and security/merge decisions. Two bounded read-only
maps cover caller/test contracts and alert locations. Desktop, user research and
comparison images remain untouched. No real patient data, provider credentials,
actual messages, Docker mutation, deployment or new local dependency installation.

## Findings and implementation order

1. **Instruction producer/consumer contract.** The API creates an instruction and
   an outbox event without linking them; the sender requires that link. Link the
   actual event atomically through the existing evidence repository. Validate its
   scope, actor, patient and action identity. Preserve request-only API semantics.
2. **Immutable intent.** A forward migration captures the intended phone for new
   WhatsApp requests and protects instruction content/author and its eventual
   action link. Do not manufacture approval for historical requests. Bound queued
   instruction age; changed contact/source or revoked authority requires review.
3. **Safe sender.** Establish transaction RLS before direct SQL. Serialize claims,
   use unique leases, revalidate consent, shared-contact STOP, actor, registration
   and source after secret lookup, and fence finalizers. Only proven no-dispatch
   outcomes retry (maximum three); thrown/uncertain transport outcomes create one
   durable reconciliation job and never authorize another send. Reconciliation
   remains honest manual review where Meta provides no authoritative lookup.
4. **Security findings.** Fix unbounded regex work in canonical contract generation
   and storage-prefix normalization; descriptor-based build-input preservation;
   same-origin, no-redirect smoke transport; and bounded restore region evidence.
   Preserve negative scanner/assertion semantics for the URL-looking findings:
   these are not URL allowlists and blindly anchoring them would weaken checks.
5. **Evidence and integration.** Add adversarial offline tests and a real-database
   instruction probe to the existing approved synthetic harness and remote CI.
   Reconcile generated contracts, schema version and all consumers. Review the
   exact committed head, require all CI/security checks, then merge into
   `mac-latest-20260829` and compare the merge tree with the tested head.

## Acceptance matrix

- Actual instruction API/evidence producer yields one correctly linked outbox
  action; replay and invalid scope/actor/event requests cannot dispatch.
- The runtime activity pool establishes RLS; wrong tenant/clinic cannot read/send.
  The separate outbox worker role retains its prohibition on clinical-table reads.
- Immutable body/template/patient/creator/recipient and action linkage; legacy
  unsnapshotted or expired instructions require a new explicit request.
- Accepted send/replay sends once. Concurrent claims, secret failure, construction
  failure, three proven no-dispatch attempts, thrown send, expired lease and late
  response are exercised against real PostgreSQL with typed synthetic transport.
- Consent/recipient/template/registration/actor/tenant/clinic changes between claim
  and dispatch block transmission; current permissions remain locked during sending,
  and valid tenant-wide authors retain access; a shared contact STOP blocks another patient's consent.
- Reconciliation insertion works against the actual partial unique indexes;
  provider acceptance remains distinct from signed delivery/read evidence.
- Long malformed brace/slash input finishes within a bounded subprocess deadline;
  generated output remains deterministic; normal routes and storage keys unchanged.
- Filesystem symlinks are rejected during snapshot; restoration replaces an entry
  without following a substituted symlink and preserves bytes/mode.
- Smoke fixtures cannot redirect credentials/body to another origin; scanner
  embedded-secret/storage detection retains its prior protective behavior.
- Workspace checks, typecheck, lint, tests, builds, generated checks, synthetic
  repository/browser/restore regression and exact-head GitHub checks pass.

## Completion boundaries

A green synthetic test is not live Meta or clinic approval. Before any real
activation, verify the official account/number, configured templates and the
clinic-approved contact/consent workflow in a controlled recipient trial. Do not
claim alert closure until a fresh CodeQL analysis confirms the final branch.
No alert will be hidden merely to obtain a green merge check.
