# CP12 Security Pipeline Foundation — Threat And Control Delta

**Lane:** Security Pipeline and Legacy Parity Foundation

**Base:** `1166baa7a816b614d896cf267066f31f40eac142`

**Evidence:** E0/E1 only

**Release decision:** unchanged NO-GO

## Controls established

| Threat/control                    | Foundation added                                                                                                                                                            | Evidence                                       | Remaining integration                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| T01 cross-tenant/IDOR             | verified identity scope derives actor/tenant/clinic; foreign snapshot rows filtered; inactive state fails closed                                                            | auth unit and CP12 role/tenant/clinic matrices | modular/native adapter must call it on every authenticated route; RLS remains mandatory |
| T02 role escalation               | role assignments are restricted to the verified user, tenant and active clinic assignment; doctor signing remains a separate route permission/role requirement in inventory | auth negative matrix                           | live revocation/session evidence remains CP14                                           |
| T06 injection/mass assignment/DoS | strict-object and runtime-validator contracts; unknown/prototype keys rejected; body/query/pagination budgets                                                               | security unit and CP12 acceptance corpus       | Lane A schemas and framework wiring must cover every operation                          |
| T21 denial/cost exhaustion        | HMAC bucket keys, atomic store interface, rate and expensive-operation policies, stable `429`/`Retry-After`                                                                 | deterministic E1 budget tests                  | distributed store, WAF and load/noisy-neighbor evidence remain integration/CP14         |
| T24 false readiness/bypass        | exact 128-route control inventory; every current route honestly non-compliant; route-policy coverage fails on missing/stale entries                                         | route inventory test                           | CP12 cannot exit until every active route consumes a policy                             |
| API error disclosure              | generic unknown errors, bounded/redacted metadata, secret/PHI key and free-text redaction, `no-store`                                                                       | error/redaction tests                          | framework exception filter must use the serializer                                      |
| Correlation provenance            | bounded request IDs, ambiguous/invalid header replacement, explicit provenance, safe audit metadata                                                                         | request-ID tests                               | ingress trust/trace propagation policy remains integration/CP14                         |

## Security invariants encoded

- Client tenant, clinic, actor, role, permission, signer, price and payment-state fields never create
  authority.
- A clinic selector is accepted only when it resolves inside the verified active identity snapshot.
- Missing route policy is a startup/configuration failure; it never falls back to public or
  identity-only access.
- Provider webhooks are explicit narrow exceptions that require raw-body signature verification and
  replay protection.
- Unknown writable fields, prototype-pollution keys and raw validator values are rejected or omitted
  from client diagnostics.
- Rate and cost decisions require an atomic store. No process-local production limiter is presented
  as multi-instance protection.
- Diagnostic error metadata is bounded and redacted; unexpected exceptions do not expose their
  messages.

## Honest limitations and open risks

This lane did not modify `apps/api/**`, so the native API does not yet consume these contracts. The
route inventory proves that all 128 current registrations remain outside a registered CP12 policy.
PRR-012, PRR-017 and PRR-028 therefore remain open.

- No distributed rate store, edge WAF, concurrency controller or load evidence exists in this lane.
- Runtime request/response schemas and generated contracts belong to the separate contract lane and
  are not duplicated here.
- No API success/error parity execution was claimed; this lane supplies the exact inventory and
  expected transition table for the later consumer.
- Current `/v1/me`, request-ID, query, error and unknown-field gaps remain reachable until API
  integration.
- Production identity/session lifecycle, CSRF/CORS/host controls, official provider activation and
  deployed edge evidence remain in their owning checkpoints.
- CP11 RLS, clocks, readiness, role separation and atomic unit of work were not modified and must be
  rerun after integration.

## Required integration assertions

The master or API-framework lane must:

1. map authenticated scope failures to stable redacted `403` responses;
2. register one `RouteSecurityPolicy` per inventory key and run exact coverage at startup/test time;
3. use Lane A's strict runtime schemas through `validateRuntimeValue` and reject unknown fields;
4. apply streaming body budgets before parsing and emit `413`;
5. apply query/pagination budgets and a real atomic rate/cost store;
6. use validated request IDs and the boundary error serializer;
7. allowlist webhook headers and preserve signature-before-parse behavior;
8. run the route-by-route legacy parity plan plus CP11 E3 regression gates.
