# Checkpoint 06 - Continuity Operations And Owner Dashboard

## Goal

Clinic staff can run continuity operations after checkout: recalls, post-op/payment follow-ups, recurring SOP tasks, lab cases, inventory checks, event/CAPA diary, and owner analytics from real domain data.

## Base

- Branch: `main`
- Base commit before launch packet: `6f9fe1c`
- Worker launch commit: `7fefa31`
- Launch date: 2026-07-07

## Scope

- Recall rules, recall due generation, post-op and payment follow-up tasks.
- Task workbench, task assignment, due/overdue state, completion, and audit evidence.
- SOP templates, recurring SOP schedules, SOP run/checklist completion.
- Lab vendors, lab cases, lab slips, case status history, and month-end reconciliation.
- Inventory categories/items, stock ledger, check templates, check runs, low-stock/procurement tasks.
- Incident/event diary and corrective/preventive action records.
- Owner dashboard projections for source-attributed revenue, recalls, tasks, lab exceptions, inventory exceptions, no-shows, and treatment-plan/payment leakage.

## Non-Goals

- Live WhatsApp/telephony sending is deferred unless a lane can use official sandbox APIs safely. CP6 must still model send/request/provider-unavailable states honestly.
- AI-generated task or analytics narratives are deferred; owner dashboard metrics must be deterministic and source-backed.
- Full procurement vendor integration is deferred; CP6 can create procurement tasks/suggestions but must not fake purchase execution.
- Full accounting exports remain deferred unless naturally covered by lab reconciliation.

## Credential/Input Preflight

- `.secrets/orchestration.env`: present.
- WhatsApp provider variables are present locally, but worker lanes must not print or commit secret values.
- `TEMPORAL_ADDRESS` is declared in `.env.example`; use local/test workflow primitives or deterministic timers if a live Temporal service is not running.
- CP6 lanes should prefer simulator/contract-backed provider behavior unless they can prove safe sandbox calls without exposing secrets.

## Lanes

| Lane | Pending Worktree ID | Thread ID | Worktree | Ownership |
| --- | --- | --- | --- | --- |
| Workflow/Task Backend | `local:6c3ba047-cd82-491b-9566-1486b4c36082` | `019f3c1d-1708-7893-bfd7-1329dff99220` | `/Users/abhinavgupta/.codex/worktrees/dbc7/ClinicOS` | Tasks, recalls, follow-up rules, SOP schedules/runs, Temporal/local workflow tests, DB/domain/API contracts |
| Lab/Inventory/Event | `local:cc373996-d87c-472b-9ca1-8fb8846722aa` | `019f3c1d-6d96-7310-ba40-bed750544a62` | `/Users/abhinavgupta/.codex/worktrees/0166/ClinicOS` | Lab vendors/cases/slips/reconciliation, inventory items/checks/stock ledger/procurement tasks, incident/CAPA diary |
| Operations UX | `local:e2d1fbe3-7bbc-4af4-b3fa-a0e27c1b9d52` | `019f3c1d-b7c5-7a32-8ee4-a1669e58aa73` | `/Users/abhinavgupta/.codex/worktrees/9f26/ClinicOS` | Recall queue, task workbench, SOP checklist runner, lab board, inventory runner, event diary, role-aware navigation and browser smoke |
| Analytics/QA | `local:a6a0b27a-81a2-4527-9041-9a1e721cc2aa` | `019f3c1e-1658-7aa2-ab3a-ca5135838beb` | `/Users/abhinavgupta/.codex/worktrees/4ff2/ClinicOS` | Owner dashboard projections, fixture/contract smoke, E2E acceptance plans, role/tenant denials, documentation |

## Shared-File Policy

| Surface | Owner For CP6 | Rule |
| --- | --- | --- |
| `package-lock.json` | Master integration | Workers must not commit lockfile changes; request dependency changes in handoff. |
| Root `package.json` | Master integration | Workers request root scripts unless explicitly assigned. |
| DB migrations | Workflow/Task Backend owns `0006_continuity_tasks_recalls_sops.sql`; Lab/Inventory/Event owns `0007_lab_inventory_events.sql` | Do not create competing migration numbers. If a lane needs another lane's table, document the dependency and let master reconcile cross-migration references on the integration branch. |
| Domain events/permissions | Backend lanes first | Analytics/UX consume canonical events. Do not invent UI-only event names. |
| API route contracts | Backend lanes own; UX consumes | Route drift must be reported early. Granular routes are acceptable; no fake aggregate route should be advertised before implementation. |
| Fixtures/test data | Analytics/QA owns deterministic fixture shape | Product runtime must not depend on fixtures outside explicit local/test fixture modes. |
| Web workflow files | Operations UX owns | Analytics/QA may add tests only unless coordinating selector/route fixes. |
| Docs/orchestration | Master integration | Workers provide handoff evidence; master records checkpoint evidence. |

## Canonical Route Intent

Workers should converge on these route families unless a better contract is documented and coordinated before merge:

- `GET /v1/tasks?status=&dueDate=`
- `POST /v1/tasks`
- `PATCH /v1/tasks/:taskId`
- `POST /v1/recall-rules`
- `GET /v1/recalls?status=&dueBefore=`
- `POST /v1/recalls/:recallId/actions`
- `POST /v1/sop-templates`
- `POST /v1/sop-schedules`
- `GET /v1/sop-runs?date=`
- `PATCH /v1/sop-runs/:sopRunId`
- `POST /v1/lab-cases`
- `PATCH /v1/lab-cases/:labCaseId`
- `GET /v1/lab-cases?status=&dueBefore=`
- `POST /v1/lab-reconciliations`
- `POST /v1/inventory/check-runs`
- `PATCH /v1/inventory/check-runs/:checkRunId`
- `GET /v1/inventory/exceptions`
- `POST /v1/incidents`
- `POST /v1/corrective-actions`
- `PATCH /v1/corrective-actions/:correctiveActionId`
- `GET /v1/owner-dashboard?from=&to=`

## Required Verification

- E2E: completed procedure or checkout instruction -> post-op follow-up and six-month recall task -> assistant marks action complete.
- E2E: lab case -> sent/returned/completed -> month-end reconciliation.
- E2E: monthly inventory check -> low-stock/procurement task.
- E2E: incident -> corrective action assigned -> corrective action completed.
- Owner dashboard uses real fixture/domain data, not static cards.
- Source-attributed revenue carries from lead/source through appointment and invoice/payment.
- Role and tenant denials: accountant sees allowed billing/analytics only; assistant cannot see owner-only analytics where forbidden; wrong tenant is denied.
- Browser smoke covers operations desktop and 390px mobile with no horizontal overflow and reachable primary controls.
- Workflow/timer tests cover due generation, overdue state, idempotency, and retry-safe behavior where timers are involved.

## Merge Order

1. Workflow/Task Backend
2. Lab/Inventory/Event
3. Analytics/QA
4. Operations UX
5. Master integration patch on `codex/integration/checkpoint-6`
6. Verified promotion to `main`

## Exit Criteria

- CP6 continuity workflows are complete for their intended scope without fake messaging, fake procurement, static analytics, or placeholder workflow completion.
- Follow-up, recall, lab, inventory, SOP, incident, and CAPA state changes are tenant/role scoped, auditable, and represented in timeline/outbox/read models where appropriate.
- Owner dashboard metrics are source-backed and documented.
- Full code checks, deterministic fixture/contract checks, browser/user checks, docs updates, and accepted-gap review are recorded before merge.
