# CP14 Identity Runtime Adapters

Status: implementation and E1/E3-local verification only. This runbook does not claim deployed
Keycloak, Redis, login, revocation, alert, backup, restore, or E4/E5 evidence.

## Redis topology contract

`RedisWebSessionStore` and `RedisTokenRevocationStore` deliberately support a writable,
non-cluster Redis primary with replicas/failover. They do not support Redis Cluster. Every operation
uses the official `redis` client with the offline queue disabled, a bounded connect timeout and
automatic reconnect disabled. The first operation and readiness inspect `INFO cluster` and require
`cluster_enabled:0`. Readiness type-checks the durable hash and ends in one expiring probe `SET`, so
a read-only replica, reconnecting client, wrong data type or unavailable process cannot admit
traffic.

Production composition must provide:

- the primary/writer endpoint for a TLS-only, ACL-authenticated, Multi-AZ primary/replica service;
- encryption at rest, automatic failover, backups and a reviewed eviction policy that never evicts
  security state (`noeviction` is the expected posture);
- separate KMS/Secrets Manager values of at least 32 bytes for web-session field HMACs, token-
  revocation field HMACs, session lookup/CSRF HMACs, and session encryption keys;
- bounded official-client queues and sanitized connection-error telemetry containing only an
  allowlisted error code;
- startup/readiness wiring that awaits both Redis adapters and the authoritative security-audit
  sink. There is no memory fallback.

Do not enable Redis Cluster for these bindings. The web-session contract can rotate an opaque
session identifier without exposing its family to the lookup call, so a correct future Cluster
design requires a revised family/locator contract and sharded outbox fan-in. A constant global hash
tag is not an acceptable scaling design.

## Atomic web-session state and required audit outbox

All session fields, family-revocation tombstones and pending required-audit fields live in one
HMAC-named Redis hash. Every session mutation performs all reads and validation first, then uses one
final `HSET` command for the complete state/audit transition. Rotation writes the next session, an
unavailable tombstone for the previous identifier and its required audit in that one command.
Revocation writes the session tombstone, family tombstone and every uniquely HMAC-keyed audit field
in one command. Lua/MULTI rollback semantics are not assumed.

Pending audit fields have no Redis TTL and must never be trimmed or evicted. The dispatcher contract
is:

1. call `scanPendingAudits(cursor, count)` in bounded pages;
2. persist the intent to the authoritative append-only security-audit table by
   `deduplication_key`;
3. on an existing key, require the stored canonical payload digest to match or page security;
4. commit the database transaction;
5. only then call `acknowledgePendingAudit(deduplicationKey)`;
6. retry after crashes. Delivery is at-least-once and the database key makes it exactly-once at the
   authoritative sink.

The current tenant-required `audit_events` table cannot safely receive login/pre-membership events
because it requires a tenant. Before composition, the master-owned canonical migration must create
`identity_security_audit_events` as the global append-only partition with this exact logical
contract (PostgreSQL types may use the repository's equivalent bounded domains):

- `id uuid primary key default gen_random_uuid()` and `deduplication_key varchar(384) not null
unique`;
- `payload_digest char(64) not null` constrained to lowercase SHA-256 hex, `schema_version smallint
not null check (schema_version = 1)`, and `canonical_payload jsonb not null`;
- bounded `action`, `subject`, `reason_code`, nullable `issuer` and `authorized_party`, with action-
  specific checks requiring issuer/party for `auth.*` events;
- nullable `tenant_id uuid references tenants(id) on delete restrict` and nullable `clinic_id uuid`,
  with the existing `(tenant_id, clinic_id)` foreign-key pattern when clinic is present;
- `occurred_at timestamptz not null`, `received_at timestamptz not null default now()`, bounded
  `source_adapter_version`, and non-sensitive `correlation_metadata jsonb not null default '{}'`;
- indexes on `(occurred_at desc)`, `(subject, occurred_at desc)` and partial `(tenant_id,
occurred_at desc)`; the existing immutable-evidence trigger (or an equivalent trigger) must deny
  update/delete;
- an insert/select-only dispatcher role: revoke update/delete/truncate, permit no generic runtime
  role write, and include this partition in the immutable security export/retention path.

The dispatcher transaction computes SHA-256 over canonical JSON, inserts with `ON CONFLICT
(deduplication_key) DO NOTHING`, then selects the stored digest under the same transaction. A digest
mismatch rolls back, pages security and leaves the Redis audit pending; a match commits before Redis
acknowledgement.

The dispatcher must page/alert on age, count, delivery failure, digest conflict and Redis failover.
No diagnostic log substitutes for the table. Required audit payloads contain no token, cookie,
secret, code verifier, authorization code or PHI body.

Session/family fields enforce logical absolute expiry on every read and mutation. Run
`purgeExpiredStateBatch` continuously in bounded cursor cycles to remove physical expired fields;
never delete pending audit fields. Alert when a full purge cycle does not complete or expired field
age exceeds the approved window.

## Distributed API revocation

`RedisTokenRevocationStore.recordRevocation` atomically writes exact access-token ID, Keycloak
session ID and/or subject-issued-through markers in one final `HSET`. Identifiers are HMAC-derived in
Redis field names. Exact marker expiry and subject cutoff/expiry are monotonic, so later duplicate or
shorter revocations cannot resurrect a token. `isRevoked` fails closed on connection, topology,
type, shape or script uncertainty.

Master composition must ingest logout, confirmed refresh replay, administrator action, membership/
role authority revision, JML transitions and break-glass expiry. Retention must cover the longest
accepted access/session token that the marker can invalidate and remain within the adapter's bounded
policy. Run `purgeExpiredRevocationsBatch` in bounded cursor cycles and alert on backlog. API
readiness must await `IdentitySessionEdgeGuard.readiness()`; a successful liveness probe is not
revocation readiness.

The writer that records a revocation must also create the applicable authoritative audit evidence
through its owning durable coordinator. The revocation lookup adapter is not a replacement for that
domain/security audit transaction.

## Keycloak OIDC BFF client

`KeycloakOidcBffClient` is server-only. It pins the canonical `/realms/<slug>` issuer and exact
Keycloak token, revocation and JWKS paths; permits local HTTP only on loopback; rejects redirects;
bounds timeout and response bytes; and sends code+PKCE, refresh and RFC 7009 revocation requests as
confidential-client form posts.

Access and ID tokens are accepted only after RS256 verification against the exact issuer JWKS,
bounded key-set parsing, issuer/audience/time checks, client `azp` binding, token/session IDs, and
access-token lifetime validation. Multi-audience ID tokens require `azp` equal to the BFF client;
any present single-audience ID-token `azp` must also match. A failed signature triggers at most one
bounded JWKS refresh for Keycloak key rotation.

The master must:

- add the web server composition dependency on `@clinic-os/auth` in the master-owned manifest and
  lockfile;
- construct `refreshProviderErrorFactory` as
  `(failure) => new WebSessionRefreshProviderError(failure)` so the frozen manager receives the
  exact typed error instance;
- source the confidential secret and endpoint configuration only from Secrets Manager/runtime
  server configuration, never public environment variables or Client Components;
- wire callback exchange to the frozen transaction/nonce validator, then create the durable Redis
  session only after verified identity and current authority resolution;
- keep `confirmedReplayErrorDescriptions` empty unless an exact Keycloak version/realm test proves
  a stable replay-specific response. Ordinary validated `invalid_grant` is a confirmed rejection,
  not replay. Network, timeout, 429/5xx, malformed success, signature, lifetime, identity drift and
  unproved replay responses are uncertain after dispatch and revoke the family;
- route logout through local family revocation first, then official Keycloak revocation, returning
  the frozen honest unconfirmed response if the provider cannot confirm it.

Never log or include in error text request URLs, form bodies, authorization codes, code verifiers,
client secrets, access/refresh/ID tokens, cookies, raw JWKS responses or provider descriptions.

## Required live gates owned by the master

Before E4 identity readiness can pass, execute against the exact staged revision:

- non-cluster managed Redis primary/replica failover, write/readiness removal and recovery;
- concurrent login rotation, touch, refresh single-flight, process death after dispatch, lost
  completion, audit backlog/dispatch/replay, revocation and state reaper tests;
- Redis backup/restore with pending audits reconciled to the authoritative table;
- official Keycloak code+PKCE login, MFA, refresh rotation, invalid_grant, realm-proven replay if
  configured, logout/revocation, JML/role change, signing-key rotation and Keycloak failover;
- proof that no token/secret appears in logs, traces, URLs, browser storage, errors or crash reports;
- alerts delivered for Redis/Keycloak readiness, pending-audit age, dispatcher failures, revocation
  failures and cleanup backlog.

Loss or uncertainty removes readiness and invalidates sessions; it never activates a process-local
fallback. No real PHI is required for these gates.
