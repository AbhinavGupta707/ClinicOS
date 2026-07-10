# CP13 Final Web Runtime Evidence

## Scope and ownership

- Frozen integration input: `ad12fe176b089e4342c1da8535f4a54f051dc8e9`.
- Final integrated implementation candidate: `9116a8ea`.
- The original visible web worktree exhausted its usage allowance before checks, evidence, or a
  commit. The master reviewed the partial direction and completed the implementation, privacy
  corrections, verification, and handoff directly on the CP13 integration branch.
- No live credentials, real PHI, provider dashboard, cloud resource, or external write was used.

## Integrated runtime

- `Cp13Workspace` mounts role-scoped front-office, clinical/dental, treatment/billing, and
  continuity/operations surfaces inside the existing clinic shell.
- All durable reads and payment-intent requests use `ClinicOsApiClient`; there is no handwritten
  route fallback, fixture repository, or unavailable aggregate route behind a claimed workflow.
- Browser authentication is a registration-only access-token provider. It fails closed when an
  official auth shell has not registered a short-lived provider. Tokens are never read from public
  environment variables, URL parameters, local storage, or session storage. The production
  BFF/session lifecycle remains PRR-016/CP14.
- Patient, encounter, and invoice selection remains transient component state. IDs are not placed
  in the URL or browser storage, and reload returns to an honest unselected state.
- Operational date ranges derive from the verified clinic timezone. Missing or invalid timezone
  data produces an unavailable state; UTC string slicing is not used.
- Accountant access is denied before any clinical request. Payment-request UI reports a pending
  provider intent and explicitly states that it is not payment confirmation.
- Loading, unavailable, denied, empty, stale, and error states are explicit. No simulator state is
  represented as provider settlement, delivery/read confirmation, clean media inspection, or
  procurement execution.

## Verification

| Gate | Result |
| --- | --- |
| Web typecheck | Pass |
| Web lint | Pass, zero warnings |
| Web unit suite | 16 files, 86/86 pass |
| Next production build | Pass |
| Enabled Playwright smoke | 4/4 pass, zero skips |
| Desktop assistant | Generated front-office calls; transient patient selection; reload clears selection |
| Desktop accountant | Pending payment intent remains non-settlement truth |
| 390 px owner | Controls reachable; no horizontal overflow; nine scoped operations reads |
| Accountant negative | Clinical surface denied before a clinical API request |
| Browser privacy/auth | Bearer and clinic headers present; no selected IDs in URL/storage; no console errors |

The required in-app Browser path was attempted first and returned exactly
`no Codex IAB backends discovered`. Per the frontend testing fallback, the master used the freshly
built Next application on isolated localhost port 3013 and ran repeatable Playwright with
`CLINICOS_CP13_E2E_ENABLED=true`. The initial unflagged invocation skipped four tests and is not
counted as evidence; the authoritative rerun executed and passed all four.

## Honest boundary

This is E2 rendered and generated-client evidence over contract-faithful intercepted responses,
paired with separate E3 live API/PostgreSQL/Temporal evidence in
`docs/qa/checkpoint-13-evidence.md`. It does not claim a production web session, deployed edge,
official provider, production media scanner, or staging environment.
