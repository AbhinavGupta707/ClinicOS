# Checkpoint 15 Evidence — Local E3 Provider Implementation Baseline

**Status:** Local implementation complete at E3. Official-provider activation, deployed callbacks
and official sandbox evidence remain open. The release is **NO-GO** for PHI, real messages, calls,
payments and clinical reliance.

**Launch base:** `87c1be0119aa1a3c93b6f27c3cebf27a716108c7`

**Integrated implementation candidate:** `f1cfe7bb`

**Branch:** `codex/integration/checkpoint-15`

**External decision:** `docs/orchestration/CHECKPOINT_14_CLOUD_DEFERRAL_DECISION.md`

## Implemented boundary

- Meta WhatsApp Cloud has opaque registration-scoped GET challenge and POST callback routes,
  bounded raw-body HMAC verification before parsing, event normalization, consent/opt-out/service-
  window controls, monotonic status truth, current/previous secret rotation and no inferred
  sent/delivered/read state.
- Razorpay has an opaque registration-scoped signed callback route, account/scope binding,
  duplicate/out-of-order/partial/overpayment/refund/dispute handling, uncertain-creation recovery,
  bounded official read-only reconciliation and no unsigned or read-derived settlement.
- Migration `0020` adds the forced-RLS provider registry, opaque route resolver, callback evidence,
  business-effect uniqueness and provider reconciliation jobs. Migration `0021` adds a forced-RLS
  worker scope queue containing tenant/clinic scheduling metadata only.
- The worker resolves only secret-manager references, discovers due scopes through the dedicated
  queue, applies transaction-local tenant/clinic RLS, claims jobs with bounded leases, revalidates
  registration identity/mode/account/activation/credential under lock and finalizes job plus provider
  health atomically.
- Meta uncertainty remains unsupported/manual review because no general authoritative status-read
  endpoint is assumed. Razorpay absence is terminal only for the exact typed official not-found
  response; other 400/404 responses retry safely.
- Provider operations expose durable activation/evidence truth without secret references. The
  registered operation count is 130: three CP15 callback operations replace the legacy global
  Razorpay alias. Telephony remains a complete disabled/unavailable workflow because no official
  provider was selected.

## Verification record

All commands ran on 2026-07-13 against the integrated candidate with synthetic data only.

| Evidence                                                       | Result                                                                                                                                                                                         | Tier / limitation                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `npm run ci`                                                   | Pass: checks, real TypeScript, lint, all workspace tests/builds, audit and secret scan                                                                                                         | Local E1/E3                                            |
| API package                                                    | 172/172 pass, zero skips, including real local socket execution and CP15 raw-body routes                                                                                                       | Local E3                                               |
| Integrations package                                           | 186/186 pass, zero skips                                                                                                                                                                       | Deterministic provider contracts, not official traffic |
| Worker package                                                 | 56/56 pass, zero skips                                                                                                                                                                         | Deterministic processor/runtime behavior               |
| Web package                                                    | 100/100 pass; production Next build passes                                                                                                                                                     | Local rendered client                                  |
| Database package                                               | 109/109 pass, including provider registry and scope-queue invariants                                                                                                                           | Static/unit E1/E3                                      |
| `npm run db:test:migrations`                                   | Pass: concurrent runners, checksum drift rejected, failed migration rolled back, canonical files unchanged                                                                                     | Clean local PostgreSQL                                 |
| `npm run cp15:test:provider-persistence`                       | Pass: clean migration, non-listable route index, signatures/replay, forced-RLS worker scope discovery, one atomic Razorpay reconciliation, health projection and no stored secrets; zero skips | Local PostgreSQL E3                                    |
| CP15 Playwright                                                | 2/2 pass: configured-but-unverified provider truth, disabled telephony, secret/identifier negatives, desktop and 390px with no horizontal overflow                                             | Intercepted deterministic API boundary                 |
| In-app browser                                                 | Live production build without API shows the registered unavailable shell, reachable retry, zero overflow, no secret-shaped text and no console errors                                          | Honest unavailable-state smoke                         |
| `npm audit --audit-level=high`                                 | Pass at the enforced threshold; 12 moderate transitive advisories remain                                                                                                                       | No force/breaking upgrade or risk acceptance           |
| `npm run security:secrets`                                     | Pass; user-owned research paths excluded by the governed scanner                                                                                                                               | No live secret file was read                           |
| `npm run check:clock`, `npm run check:env`, `git diff --check` | Pass                                                                                                                                                                                           | Repository hygiene                                     |

The persistence proof uses the real `clinic_os_runtime` and `clinic_os_worker` roles. Without a
transaction-local scope the worker sees zero provider jobs, while its global queue view contains
only the due tenant/clinic identifier. After claim and scoped processing, the job is `matched`, the
registration health timestamps are updated in the same finalization transaction, and the empty
scope queue row is removed.

## Security review outcome

Master review rejected the first reconciliation handoff until it revalidated every registration
field under lock, proved stale-lease rejection, distinguished authoritative payment absence from
other 400/404 failures, removed identifiers from safe operation details and bounded provider reads
inside the lease. The corrected lane was merged only after its full worker/integration suites passed.

See `docs/security/checkpoint-15-threat-model-delta.md` and
`infra/runbooks/official-provider-activation.md`.

## Exit gates still open

These are external hard gates, not accepted production risks:

1. There is no deployed stable HTTPS edge because AWS/DNS activation remains owner-deferred. Meta
   and Razorpay dashboards therefore have no registered ClinicOS callback URL.
2. No official Meta challenge/callback/send lifecycle or Razorpay sandbox payment/refund/dispute
   lifecycle has run against the exact candidate.
3. No official telephony provider, account, credential, callback or sandbox evidence exists. The
   workflow remains disabled whole.
4. No deployed WAF/rate, provider alert delivery, credential rotation, multi-worker crash/restart,
   outage, replay or rollback exercise exists.
5. CP14 cloud/media/identity/telemetry/recovery E4/E5 gates remain open and govern any later provider
   activation.

The candidate is eligible for local promotion under the explicit owner deferral so later
implementation can consume its fail-closed contracts. That promotion does not mean CP15 passed its
official-sandbox E4/full exit contract.
