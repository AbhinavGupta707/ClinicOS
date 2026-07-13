# ClinicOS Native HTTP Route Inventory

The machine-readable active inventory is
`packages/api-contracts/generated/native-route-inventory.json`. It is generated from runtime
schemas and independently compared with static discovery of `apps/api/src/server.ts`.

The same inventory includes the exact response paths that expose initial `rowVersion` values for
the twelve If-Match resource families. Human-readable mapping and runtime-integration obligations
are in `docs/api/VERSIONED_RESPONSE_METADATA.md`.

## Active operation totals

| Origin    | Active operations | Principal families                                                                      |
| --------- | ----------------: | --------------------------------------------------------------------------------------- |
| CP1       |                 4 | liveness, startup/readiness, current identity                                           |
| CP15      |                 3 | Meta challenge/webhook and Razorpay webhook on opaque registration-scoped callback URLs |
| CP2       |                22 | patients, leads, appointments, queue, morning dashboard                                 |
| CP3       |                15 | intake, consents, encounters, note/prescription signing                                 |
| CP4       |                11 | dental chart/history/snapshots, mediated media                                          |
| CP5       |                11 | pricebook, plans, procedure evidence, invoices, payments, instructions                  |
| CP6       |                34 | owner analytics, tasks/recalls/SOP, lab, inventory, incidents/CAPA                      |
| CP7       |                10 | provider health, dead letters, reviewed migration batches                               |
| CP8       |                 8 | session-scoped AI scribe review foundation                                              |
| CP9       |                11 | audit review, exports, retention/deletion, break glass                                  |
| CP10      |                 1 | conservative pilot-readiness report                                                     |
| **Total** |           **130** |                                                                                         |

## Deferred or unregistered workflow classification

| Workflow                               | Classification                     | Route family                                             | Why it is not active                                                                                                                   |
| -------------------------------------- | ---------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Appointment confirmation request draft | stale fixture/note only            | `POST /v1/appointments/{id}/confirmation-request`        | Active router has confirm/check-in/no-show, not this older request route.                                                              |
| Assistant dashboard legacy alias       | stale fixture/note only            | `GET /v1/assistant/morning-dashboard`                    | Canonical active route is `GET /v1/dashboard/morning`.                                                                                 |
| External imaging links                 | deferred whole                     | `/v1/media/{id}/links` and callbacks                     | No official imaging adapter/workflow is registered.                                                                                    |
| Aggregate CP5 checkout read model      | fixture only                       | `GET /v1/clinical-workflows/cp5`                         | Granular durable routes exist; the aggregate read model does not.                                                                      |
| Meta WhatsApp provider activation      | route active/provider unregistered | `/v1/provider-callbacks/meta-whatsapp/{registrationKey}` | Signed registration-scoped GET/POST routes are active; deployed HTTPS, provider-dashboard and official-sandbox evidence remain absent. |
| Razorpay provider activation           | route active/provider unregistered | `/v1/provider-callbacks/razorpay/{registrationKey}`      | The signed registration-scoped POST route is active; deployed HTTPS, provider-dashboard and official-sandbox evidence remain absent.   |
| Telephony callback                     | provider unregistered              | `/v1/webhooks/telephony/*`                               | No signed telephony callback route/provider registration exists.                                                                       |
| AI aggregate review queue              | fixture/config only                | `GET /v1/ai-scribe/review-queue`                         | Only session-scoped AI routes are active.                                                                                              |
| FHIR exchange API                      | projection only                    | `/v1/fhir/*`                                             | FHIR is a package projection/validator, not a registered HTTP workflow.                                                                |
| ABDM/ABHA exchange                     | provider unregistered              | `/v1/abdm/*`                                             | No approval, credentials or exchange route exists.                                                                                     |
| Native capture control plane           | deferred whole                     | `/v1/mobile/capture/*`                                   | Device capture and encrypted offline queue await CP16 evidence.                                                                        |

The CP15 Meta and Razorpay callback routes are registered, but official provider callback
registration/sandbox evidence remains an activation gate. Runtime route presence in this inventory
does not imply provider activation, reachability, or provider-confirmed traffic.

## Inventory gate

`node scripts/cp12-openapi-route-inventory.mjs` discovers exact route conditions and dynamic path
patterns from the native router with the installed TypeScript parser. It normalizes path parameter
names and compares method/path keys to the contract registry. A new native route without a contract,
or a stale contract for an absent route, fails non-zero.
