# Checkpoint 11 Threat-Model Delta

**Scope:** CP11 E3 durable local verification foundation
**Base revision:** `1332d3c4391874e40ba35b76192a9472b3d541bf` plus the recorded dirty CP11 working tree
**Data:** explicit synthetic-only, no real PHI or provider traffic
**Production decision:** **NO-GO**

CP11 changes the local trust boundary from an unapplied schema plus fixture repositories to a
checksum-tracked PostgreSQL schema, scoped runtime/worker identities, forced RLS, atomic durable
writes, dependency-aware traffic admission, and runtime-ID smoke. It does not establish deployed
cloud, production identity/session, provider, media, device, immutable-export, or restore controls.

| Threat | CP11 control delta | E3 evidence | Residual / next owner |
| --- | --- | --- | --- |
| T01 cross-tenant access | All 96 tenant-owned tables are forced-RLS; identity bootstrap is read-only; pooled context uses transaction-local settings; runtime and worker roles cannot bypass RLS. | `db:verify`, `db:test:repositories`, two-pass runtime smoke | Route-complete generated validation and E4 deployment tests remain CP12/CP14. |
| T08 duplicate effects | API operations, audit, timeline and outbox share one transaction; idempotent duplicate writes create one outbox effect; worker claim/retry/attempt/dead-letter state is durable. | repository atomicity/rollback, live duplicate submission, `worker:test:persistence` | Temporal workflow crash/replay reconciliation remains CP13. |
| T15 audit destruction/evasion | Runtime update/delete/truncate on audit is revoked; failed domain/audit/outbox transaction rolls back; server timestamps use injected clock at critical boundaries. | privilege assertions and forced rollback | Tamper-evident signed/WORM export and privileged-query monitoring remain CP14. |
| T18 dependency outage | API liveness, sticky startup and current readiness are separate; bounded Postgres schema and Keycloak JWKS probes remove traffic and recover. Worker health checks Postgres outbox, registered handlers and Temporal; worker restart is clean. | Postgres/Keycloak stop/start matrix, worker two-cycle restart | Redis is not an API synchronous dependency at CP11. Deployed load-balancer, queue backpressure and provider faults remain CP14/CP15. |
| T19 supply chain | Flyway image is version-and-digest pinned; migration names are contiguous and checksummed; repository gates exclude user-owned research without modifying it; npm high-severity audit and secret scan run. | Flyway drift/lock/failure suite, repository check, audit, secret scan | Moderate transitive advisories remain recorded; SBOM, image/IaC scans, signing and provenance remain CP14. |
| T24 false readiness/fixture leakage | Durable and fixture repository flags are independent; production-like startup rejects fixture modes; readiness reports repository/auth mode and evidence tier; E3 smoke detects any fixture fallback and discovers runtime IDs. | health unit/fault tests, two zero-skip live runs, rendered blocked owner surface | Provider/cloud/device/restore readiness remains disabled and requires E4-E6 evidence. |

## New abuse cases reviewed

- A broad background worker credential could bypass tenant controls and read PHI. CP11 instead adds
  `clinic_os_worker`, whose explicit RLS policy and grants cover only outbox events, attempts and dead
  letters; a product-table read is denied.
- A worker crash after claiming an event could strand it. Claim state has a bounded lease and durable
  retry fields; CP13 still owns stale-lease recovery and end-to-end Temporal reconciliation.
- A failed worker startup could leave its health listener alive and falsely appear available. CP11
  now closes health and database resources on startup/runtime failure and treats requested shutdown
  as a clean exit.
- An operator could edit an applied migration and use repair to hide it. The runner validates
  checksums, rejects drift, disables clean, serializes concurrent runners, and the runbook requires a
  forward fix rather than repair-as-suppression.

## Unchanged hard gates

T02-T07, T09-T14, T16-T17 and T20-T23 are not closed by CP11. In particular, production
authentication/session lifecycle, runtime-schema coverage for all routes, provider callbacks,
production media, physical-device security, deployed telemetry/alerts, restore/failover, load,
infrastructure policy and real-clinic approvals remain open. CP11 E3 completion must not be read as
pilot or production approval.
