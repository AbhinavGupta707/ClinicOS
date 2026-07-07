# Checkpoint 05 - Treatment Plan, Checkout, Payments, Prescriptions, And Instructions

## Goal

Doctor, assistant, and receptionist users can convert clinical treatment intent into a phased treatment plan and estimate, generate an invoice from accepted/completed procedures, request or record payment through verified provider/manual paths, generate a receipt, and print or send signed prescriptions and approved post-care instructions.

## Base

- Branch: `main`
- Base commit before launch packet: `1e6e3cb`
- Fresh relaunch base after CP4 re-verification: `d3d341f`
- Launch date: 2026-07-07

## Scope

- Pricebook and procedure catalog for dental checkout.
- Treatment plans, phases, estimate items, acceptance status, and procedure-performed records.
- Invoice, invoice item, invoice state, payment request, payment transaction, receipt, and reconciliation state.
- Payment provider interface for Razorpay dynamic QR/payment link creation, webhook signature verification, idempotent webhook replay, partial-payment representation, manual-payment audit, and provider-unavailable states.
- Checkout web workflow for treatment plan builder, estimate preview, acceptance, invoice creation, payment request/status, receipt generation, and instruction template selection.
- Prescription and instruction workflow extensions that reuse CP3 doctor-only prescription signing and add print/send-ready instruction records.

## Non-Goals

- Live deployed Razorpay webhook callback registration is deferred until a deployed HTTPS endpoint exists. CP5 must still implement webhook verification and replay-safe local/provider-simulator tests.
- Refund execution can be represented but not sent to a live provider unless already supported by the provider interface in this checkpoint.
- Accounting exports beyond accurate billing/payment state are deferred to later operations/analytics checkpoints.
- Recalls/tasks created from checkout may be represented as events or pending follow-up requests; the full continuity workbench belongs to Checkpoint 6.

## Credential/Input Preflight

- `.secrets/orchestration.env`: present.
- `PAYMENT_PROVIDER`: configured locally.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`: present locally.
- `RAZORPAY_WEBHOOK_URL`: empty, so live hosted webhook registration is an accepted live-provider gap for CP5.
- CP5 lanes must use simulator/contract-backed provider flows for automated verification unless they can prove safe sandbox calls without exposing secrets.

## Lanes

### Active Relaunch Lanes

These lanes were relaunched after CP4 re-verification fixed the web live media route drift. Use these lanes for CP5 integration.

| Lane | Pending Worktree ID | Thread ID | Worktree | Ownership |
| --- | --- | --- | --- | --- |
| Billing Domain | `local:57f1e52c-12d3-4712-bb03-c460eae56e42` | `019f3bcc-2145-7dc0-9518-dc8477e86b51` | `/Users/abhinavgupta/.codex/worktrees/a598/ClinicOS` | Pricebook, treatment plans, estimates, procedure performed records, invoices, receipts, DB migration, repository contracts, core billing API routes, domain tests |
| Payment Provider | `local:42818d80-8709-4a09-9e19-107c519db2e3` | `019f3bcc-213b-7191-8424-2856a60a85a0` | `/Users/abhinavgupta/.codex/worktrees/fae5/ClinicOS` | Razorpay/simulator provider interface, dynamic QR/payment link request contract, webhook verification/idempotency, payment transaction reconciliation, no-key/unavailable states, provider tests |
| Checkout UX | `local:e7a4b597-aa4a-4a50-9543-9c1da12ff7d1` | `019f3bcc-213b-7191-8424-284dd78c7323` | `/Users/abhinavgupta/.codex/worktrees/82db/ClinicOS` | Web checkout workflow, treatment plan builder, estimate/invoice/payment/receipt UI, instruction picker, role-aware controls, desktop and 390px mobile smoke |
| Clinical Output QA | `local:8997eec3-d82f-4348-b27d-b4349d72ab19` | `019f3bcc-216e-79b3-bd9d-db6d77e928a5` | `/Users/abhinavgupta/.codex/worktrees/1f2d/ClinicOS` | Synthetic CP5 fixture, contract smoke, acceptance tests, prescription/instruction tests, payment replay/denial tests, QA docs and E2E plan |

### Initial Failed Lanes

The initial CP5 lanes below were created at `f495c02` but failed before implementation due the Codex account usage-limit error. Do not use them for CP5 integration.

| Lane | Pending Worktree ID | Thread ID | Worktree | Ownership |
| --- | --- | --- | --- | --- |
| Billing Domain | `local:a52e7c05-cc94-4402-a5e9-81813fbb6cc9` | `019f3a78-1296-7181-b6c0-4bd718b77880` | `/Users/abhinavgupta/.codex/worktrees/5b11/ClinicOS` | Pricebook, treatment plans, estimates, procedure performed records, invoices, receipts, DB migration, repository contracts, core billing API routes, domain tests |
| Payment Provider | `local:f5ea13e2-dc84-4670-aec6-76a01eda862b` | `019f3a78-5814-7f13-8e82-b621dbf0d218` | `/Users/abhinavgupta/.codex/worktrees/fd39/ClinicOS` | Razorpay/simulator provider interface, dynamic QR/payment link request contract, webhook verification/idempotency, payment transaction reconciliation, no-key/unavailable states, provider tests |
| Checkout UX | `local:0c746ebb-eb92-40f9-8b06-fcadda99fabc` | `019f3a78-9489-7f91-ad96-338c8933028b` | `/Users/abhinavgupta/.codex/worktrees/8a54/ClinicOS` | Web checkout workflow, treatment plan builder, estimate/invoice/payment/receipt UI, instruction picker, role-aware controls, desktop and 390px mobile smoke |
| Clinical Output QA | `local:6770c7ad-26d3-4dda-8cd8-49e768801e7f` | `019f3a78-cf86-7c61-8bf1-7738310bcc3e` | `/Users/abhinavgupta/.codex/worktrees/7b0f/ClinicOS` | Synthetic CP5 fixture, contract smoke, acceptance tests, prescription/instruction tests, payment replay/denial tests, QA docs and E2E plan |

## Launch Blocker

The CP5 lanes were created with the documented visible project-scoped worktree shape, and Codex created the worktree checkouts at `f495c02`. The assistant turns did not start because the Codex background model execution layer returned an account usage-limit error.

Evidence:

- Failed Billing retry thread: `019f3a79-c12d-7363-aa9e-2451f4f90864`, pending worktree `local:e080d56d-7c8e-4aed-9ff5-2dff7516bc39`, worktree `/Users/abhinavgupta/.codex/worktrees/5122/ClinicOS`.
- Worktree health check passed: the replacement billing worktree exists, is detached at `f495c02`, and contains the full ClinicOS checkout.
- Local Codex log evidence for thread `019f3a79-c12d-7363-aa9e-2451f4f90864`: `Turn error: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Aug 6th, 2026 3:33 AM.`
- Retrying the replacement Billing lane at medium reasoning effort produced the same usage-limit error.

Result: CP5 implementation lanes are not active. Do not merge or claim CP5 progress until the account/model execution limit is cleared and the lanes are relaunched or resumed successfully.

The blocker was cleared for the master session by the fresh relaunch above. The active CP5 lanes are now the relaunch lanes based at `d3d341f`.

## Shared-File Policy

| Surface | Owner For CP5 | Rule |
| --- | --- | --- |
| `package-lock.json` | Master integration | Workers must not commit lockfile changes; request dependency changes in handoff. |
| Root `package.json` | Master integration | Workers request root scripts unless explicitly assigned. |
| DB migrations | Billing Domain | Payment Provider may request fields, but do not create a competing CP5 migration. |
| Billing/payment domain contracts | Billing Domain first | Payment Provider and Checkout UX consume documented domain/API contracts; route drift must be reported early. |
| Provider abstractions | Payment Provider | Keep production provider and simulator behind the same typed contract; no fake paid state without verification. |
| `apps/api/src/operations.ts` and `apps/api/src/server.ts` | Billing Domain + Payment Provider by route family | Coordinate exact route ownership; avoid duplicate parser helpers and route aliases. |
| `apps/web/**` | Checkout UX | QA may add tests only; avoid rewriting CP3/CP4 workflow behavior unless checkout integration requires a small navigation extension. |
| Fixtures/test data | Clinical Output QA | Product runtime must not depend on fixtures outside explicit local/test fixture modes. |
| Docs/orchestration | Master integration | Workers provide handoff evidence; master records checkpoint evidence. |

## Canonical Route Intent

Workers should converge on these route families unless a better contract is documented and coordinated before merge:

- `GET /v1/pricebook/procedures`
- `POST /v1/patients/:patientId/treatment-plans`
- `PATCH /v1/treatment-plans/:treatmentPlanId`
- `POST /v1/treatment-plans/:treatmentPlanId/accept`
- `POST /v1/encounters/:encounterId/procedures`
- `POST /v1/invoices`
- `GET /v1/invoices/:invoiceId`
- `POST /v1/invoices/:invoiceId/payment-requests`
- `POST /v1/invoices/:invoiceId/manual-payments`
- `POST /v1/payment-webhooks/razorpay`
- `POST /v1/invoices/:invoiceId/receipts`
- `POST /v1/patients/:patientId/instructions`

## Required Verification

- E2E: treatment plan -> estimate acceptance -> procedure performed -> invoice -> payment request -> verified payment webhook or manual audited payment -> receipt.
- Webhook replay does not duplicate payment transactions or overpay invoices.
- Unverified or badly signed provider payload cannot mark an invoice paid.
- Partial payments are represented and keep invoice state accurate.
- Manual payment requires actor, amount, method, and reason/reference, and creates audit evidence.
- Doctor-only prescription signing remains enforced.
- Instruction generation/print/send request creates timeline/audit/outbox evidence without pretending a live WhatsApp send occurred unless a configured provider confirms it.
- Accountant can see billing/payment views but cannot view clinical PHI by default.
- Wrong-tenant access is denied for treatment plans, invoices, payments, receipts, and instructions.
- Browser smoke covers checkout desktop and 390px mobile with reachable controls and no fake paid state.

## Merge Order

1. Billing Domain
2. Payment Provider
3. Checkout UX
4. Clinical Output QA
5. Master integration patch on `codex/integration/checkpoint-5`
6. Verified promotion to `main`

## Exit Criteria

- CP5 checkout workflows are complete for their intended scope without mock payment success or placeholder product behavior.
- Payment state changes are tenant/role scoped, auditable, idempotent, and derived from verified provider/manual evidence.
- Treatment plan, invoice, payment, receipt, prescription, and instruction events appear in patient timeline or outbox evidence as appropriate.
- Full code checks, provider simulator/local webhook tests, live local API smoke, and browser/user checks are recorded before merge.
