# Checkpoint 13 Threat-Model Delta

## Scope

This delta covers the CP13 durable clinic-day integration at E3 local scope. It does not close
deployed edge/session, cloud, official-provider, production-media, device, or real-clinic threats.

| Threat / failure mode | CP13 control | Evidence / remaining boundary |
| --- | --- | --- |
| Cross-tenant or wrong-clinic record access | All 100 tenant-owned tables force RLS; scope is transaction-bound; runtime without context sees zero rows | Clean and post-smoke DB verification; tenant negative tests. Deployed identity/session remains CP14. |
| Caller-supplied authority or mass assignment | CP12 strict contracts feed exact CP13 handler maps; module ports omit tenant/clinic/actor inputs | 128-route drift/inventory, negative corpus, 123 API tests |
| Duplicate/replayed mutation divergence | Transaction-bound idempotency, conditional row versions, scoped outbox keys, provider evidence digests | Two durable smokes, request-guard suites, provider mismatch/replay tests |
| Lost side effect after database commit | Action outbox and provider intent commit with domain/audit evidence; Temporal uses deterministic workflow IDs | Crash-after-commit and worker-restart recovery pass |
| Duplicate worker delivery or stale lease | Leased worker claims, `REJECT_DUPLICATE`, stale-lease recovery, candidate-count progress semantics | Recovery proof and worker 16/16 suite |
| Workflow infinite loop/history growth | Signed bounded cursors, maximum batch 25, no-progress failure, continue-as-new and version marker | Workflow 10/10, DB cursor tests, live continuity recovery |
| False payment settlement | Payment-request intent is pending only; signed event required; overpayment is capped and reconciled | Signed simulator webhook, invalid signature denial, replay and reconciliation evidence |
| Clinical signature/consent abuse | Assigned active doctor required; assistant signature denied; treatment/photo/audio consent gates; revocation effective immediately | API/domain matrix and both E3 smokes |
| Private media/provider metadata disclosure | Server-generated filenames, narrow public DTO, provider object version/key/path removed, patient media stays pending until inspection | Response-guard tests and E3 media receipt |
| Browser PHI/token persistence | Registration-only token callback; no URL/storage record IDs or tokens; reload clears selection | Four enabled Playwright scenarios |
| Transaction client query overlap | Repository-port lease serializes operations on a single transaction-bound pg client | Regression test plus warning-free traced smoke |
| False readiness from fixtures | E3 scripts require runtime DB URL, runtime-discovered IDs, durable evidence counts, and `fixtureFallback: false` | Two full API smokes and clean DB lifecycle |
| Supply-chain drift | Lockfile, generated-client drift, route inventory, secret scan, SBOM | Local gates pass; registry audit evidence is user-provided for unchanged lockfile; CP14 owns broader SAST/IaC/image/signing |

## Release impact

PRR-014 and the remaining CP13 portion of PRR-027 are closed at E3 durable-local scope. ClinicOS
remains **NO-GO** because the production session, deployed edge/cloud, official providers,
production media, restore/failover, security operations, physical devices, and real-clinic evidence
are still open under CP14-CP18.
