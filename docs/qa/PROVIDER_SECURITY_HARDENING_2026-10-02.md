# Provider dispatch and security hardening

Date: 2026-10-02. Base: `52dddeb8e14f35436cc6bec438299b03315e17d3`
(merged PR #12). Branch: `codex/provider-security-hardening`.
Scope: [implementation plan](../orchestration/PROVIDER_SECURITY_HARDENING_PLAN_2026-10-02.md).
Local engineering acceptance passed. Merge requires green checks and reviewed
security findings on the exact PR head; consult the PR for its final merge state.

## What changed

The older care-instruction API created an instruction and an outbox event without
linking them. The sender required that link, so its permissive SQL mock did not
represent a working database path. The evidence repository now links the actual
action atomically, validates author/patient/action identity, and rolls back a
conflicting event. The API response remains request evidence, never delivery.

Migration 0037 captures the intended recipient for new WhatsApp instructions and
freezes content, author, patient, time and eventual action linkage. It deliberately
leaves historical recipient snapshots empty. Old requests need a new explicit
request; the migration cannot invent consent or authorize transmission. It also
stores the first dispatch source digest and normalizes exhausted care-instruction
retry flags. The bounded backfill temporarily lifts owner RLS enforcement inside
the migration transaction and restores FORCE RLS before commit.

The sender now establishes transaction RLS, verifies the complete persisted event
identity, checks a 15-minute request lifetime, and commits a unique attempt lease
before secret lookup. It then rereads current authority, phone, consent, shared
contact STOP, provider registration and template lifecycle before transmission.
Source changes require review. Tenant/clinic/user deactivation and permission
revocation block dispatch; tenant-wide owners retain the API's scope semantics.
Both care and appointment senders use the same locked authority check.

Only proven non-dispatch may retry, at most three times. An unknown thrown send,
an explicit ambiguous result or an expired lease records uncertainty and one
reconciliation job; none permits automatic resend. A stale worker reports durable
state, never its late response as success. Refused retries become durably terminal.
Recipient HMAC normalization matches the signed callback path. Provider acceptance
and signed delivery/read evidence remain separate from instruction request state.

A shared clinic dispatch lock orders send finalization and signed callback batches,
including mixed STOP/status events. The bounded provider transport holds the
relevant transaction locks; callbacks/sends in that clinic can wait for its
10-second transport timeout. This favors safe ordering over per-clinic throughput.
Secret/template network lookup remains outside the transaction. The activity pool
uses `DATABASE_URL` with forced RLS; the separate `WORKER_DATABASE_URL` outbox role
still cannot read clinical instructions. No grants were broadened.

## Security alert disposition

The baseline contains 19 open CodeQL findings on the reviewed PR #12 head. Four
older dismissed identity findings were already dismissed before this slice and
were not changed. No new alert suppression or dismissal is part of this repair.

| Baseline alerts | Meaning and repair |
| --- | --- |
| 2, 3 | Nested malformed route braces could cause excessive regex work. Canonical registry and generated-client regexes now exclude opening braces; generated output is reconciled. |
| 23 | Storage prefix trimming could repeat work across long slash sequences. Linear boundary scanning preserves the same valid keys. |
| 31 | Build-input backup used path-based check/read. Descriptor-based no-follow snapshot and atomic entry replacement protect against substituted symlinks. Failed restore retains backups and owner evidence for manual recovery. |
| 24 | FHIR consent policy was an array membership check, not a URL allowlist. Explicit exact-element equality makes that contract clear; string/prefix/suffix/host-confusion cases fail. |
| 7 | Test asserted absence of an embedded sensitive hostname. An explicit negative escaped-host regex preserves the stronger anywhere-in-output check. |
| 18–21 | Secret/storage scanners deliberately search anywhere in content. Literal host/prefix scanning preserves embedded detection rather than weakening it with URL anchors. |
| 8 | Restore-region environment strings could reach evidence/log output. Only fixed supported region labels are emitted; invalid values fail without printing them. |
| 10–17 | Eight smoke tools intentionally send synthetic fixture data to an operator-configured test API. Their common transport now enforces same-origin rooted routes, rejects URL credentials/control characters, disallows redirects and bounds request time. The intended fixture-body transfer remains. |

CodeQL's [file-access-to-http query](https://codeql.github.com/codeql-query-help/javascript/js-file-access-to-http/)
asks reviewers to examine file data sent over HTTP. Those eight tools are intentional
fixture runners, not arbitrary-file upload endpoints. Same-origin and redirect
controls address destination escape; moving the call into a helper does not make
the intended transfer disappear conceptually. The
[filesystem race guidance](https://codeql.github.com/codeql-query-help/javascript/js-file-system-race/)
also supports using an opened descriptor for the snapshot. Final branch analysis,
not this table or a successful CodeQL job alone, determines reported alert state.

## Verification

All local dependencies were already installed. Logs, native database files,
backups and caches are retained on Spectra under
`.audit-spectra-retirement-20260920/provider-security-20261002/`; full native runs
use the existing `migration-assurance-20261002/native-*` evidence directory.
The new instruction probe owns its own synthetic tenant, user and registration.
It cannot change the existing browser fixture's identity or inbox counts.

- Thirteen security guard/restore tests passed, including actual loopback HTTP 307
  refusal, missing/encoded/generated path parameters, 200,000-character adversarial
  input, symlink replacement, failed restoration and
  primary/DR region output leakage. FHIR parsing cases run in the workspace suite.
- Twenty instruction database scenarios cover the actual API producer, outbox
  consumer input, scoped activity sender, atomic rollback, wrong identities,
  immutable content, concurrent claims, bounded retries, uncertainty, expiry,
  staff/tenant/clinic/permission changes, tenant-wide owners and signed callbacks.
  The Temporal start port is a typed test double; this probe does not claim a real
  Temporal server or real Meta delivery. Existing workflow contract/recovery gates
  remain required separately in CI.
- Fourteen appointment communication repository scenarios are regression coverage
  for the shared authority and callback ordering changes.
- The complete native run `migration-assurance-20261002/native-t9dheg7g`
  passed all 32 orchestration steps, 233 API tests, 28 browser cases, the
  5,000-patient import/replay and a real 144-table/10-document restore. All three
  owned PostgreSQL/Redis processes exited cleanly. This complete run preceded the
  last mixed-role and reverse-lock refinements.
- The final two-sender rerun `provider-security-20261002/native-i13_336i`
  includes those refinements: all 20 instruction scenarios, 14 appointment
  scenarios, 233 API tests and four browser cases passed. Both owned services
  exited cleanly. The mid-helper permission-revocation case verifies that a
  waiting grant change serializes without a reverse-lock deadlock.
- The final upgrade `provider-security-20261002/native-895isbyh` seeded a
  historical unsnapshotted instruction and an exhausted outbound record at schema
  036. Applying 037 through the normal migrator preserved the missing approval,
  blocked dispatch, normalized the exhausted retry flag and restored FORCE RLS.
  Both owned services exited cleanly.
- Final workspace check, typecheck, lint, **1,232 tests (zero skipped)**, builds,
  dependency-patch verification, release-scope secret scan, generated drift and
  the **187-route** inventory passed after the final authority changes. See
  `provider-security-20261002/final-gates.json` and `post-review-checks.json`.
- Exact-head GitHub quality, image/security, CodeQL and dependency gates are
  required before merge. A green analysis job alone is not alert closure; inspect
  the branch alert instances and preserve the intentional-transfer classification
  above. The PR records the final remote disposition.

Earlier failing runs remain retained. They identified real SQL actor-type,
JavaScript timestamp precision and retry-constraint defects, plus probe role and
fixture-isolation mistakes. These were corrected rather than bypassed or counted
as passing evidence. The original single permissive sender SQL mock was replaced
by a constructor guard and mandatory real-database coverage.

## Remaining boundaries

**Live Meta activation and production release remain NO-GO.** No account was
activated, no real message sent, and no patient data read. Desktop and Docker were
untouched. No dependency installation, provider call or deployment occurred.

The older care template path still consumes approved lifecycle/name/language
configuration and inserts the immutable authored instruction as one body parameter.
It does not acquire the appointment screen's exact provider-template preview by
association. Before enabling care sending, independently verify its one-body-
parameter template and clinical wrapper, official account/number, signed callbacks,
secret protection and clinic-approved recipient consent in a controlled trial.
If the clinic needs changing/template-specific wrappers, build and validate that
review contract before enabling it. Unknown delivery still requires actual provider
evidence; staff cannot turn uncertainty into permission to resend.

Private export validation, clinic sign-in, staff rehearsal and representative
migration reconciliation remain separate acceptance steps. AI, email, campaigns,
automated attendance and new provider integrations are outside this repair.
