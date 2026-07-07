# Checkpoint 10 - Release Candidate And Pilot Rollout Readiness

- Launch date: 2026-07-07
- Launch base: `a2d6501`
- Source plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md` section 18
- Integration branch: `codex/integration/checkpoint-10`

## Outcome

ClinicOS is release-candidate ready for a selected pilot clinic: pilot configuration is explicit, user-facing rough edges are honest and responsive, end-to-end regression evidence covers the full dental-first clinic day, and operations/support/docs identify go-live gates and deferred whole workflows without weakening shipped behavior.

## Credential And Input Preflight

`.secrets/orchestration.env` is present locally and must not be printed or committed. CP10 can proceed autonomously with local/synthetic/simulator evidence. Live provider, ABDM, AWS apply, GitHub push, and physical-device checks remain explicit external verification gaps unless separately approved and configured.

## Lane Ownership

| Lane                | Ownership                                                                                                                                                                                                             | Forbidden/shared policy                                                                                                                                                                                                                                                                                                                                                                                    | Required verification                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilot Configuration | Pilot onboarding checklist, clinic setup/status model, template/pricebook/recall/provider-readiness configuration artifacts, synthetic pilot fixtures, and any narrow API/domain helpers needed for release readiness | May edit `fixtures/synthetic/cp10/**`, `packages/domain/**` only for pilot readiness contracts, `apps/api/**` only for narrow read-only readiness/config routes, `apps/web/**` only for pilot configuration consumers, and `docs/qa/**`. Coordinate migrations and package manifests with master before committing. Do not activate live providers or claim real pilot readiness from missing credentials. | Domain/API tests for any added contract, fixture validator, provider no-key/unavailable checks, `npm --workspace @clinic-os/api test` if API changes |
| UX Polish           | Rough but production-honest web/mobile release-candidate UI states: empty/loading/error/offline/unavailable copy, responsive polish, role-safe navigation, and safety wording                                         | May edit `apps/web/**`, `apps/mobile/**`, UI tests, and narrow docs. Do not redesign the product or add marketing/landing pages. Do not introduce fake PHI, fake completions, or broad new workflows. Coordinate route assumptions with Pilot Configuration and QA.                                                                                                                                        | Web/mobile typecheck/tests, browser smoke at desktop and 390px for touched surfaces, no horizontal overflow, honest unavailable/error states         |
| End-To-End QA       | Full CP10 clinic-day regression harness, role matrix, tenant isolation, provider unavailable/no-key state checks, migration dry-run evidence, and E2E bug triage                                                      | May edit `fixtures/synthetic/cp10/**`, `scripts/*cp10*`, `tests/acceptance/**`, `tests/e2e/**`, and `docs/qa/**`. Do not change product code except narrow testability fixes agreed in handoff. Route names must be canonical and reconciled with live APIs.                                                                                                                                               | CP10 fixture validator, CP10 contract/e2e dry-run, full role matrix assertions, provider unavailable/no-key checks, targeted Playwright smoke        |
| Operations/Docs     | Release notes, pilot operator/training runbooks, support/admin checklists, known-risk/deferred-work register, final release-candidate report                                                                          | May edit `docs/**`, `infra/runbooks/**`, `docs/orchestration/**`, and docs-only support checklists. Do not create live cloud/provider resources. Do not move checkpoint state to complete until master records verification evidence.                                                                                                                                                                      | Docs formatting, runbook consistency checks, release checklist completeness, accepted-gap register                                                   |

## Shared-File Policy

- Master owns `package-lock.json`, root `package.json`, checkpoint log/memory finalization, and final integration branch promotion.
- Workers should not edit prior checkpoint fixture scripts except to reference them from CP10 regression harnesses.
- Only one lane may propose migrations. A CP10 migration should be avoided unless the lane owns a real release-readiness data contract that cannot be represented by existing tables/config.
- API route additions must be read-only/status/configuration oriented unless the lane implements a complete production workflow with audit, permission, tests, and docs.
- Browser smoke remains mandatory for touched web surfaces, even if final visual design is deferred.

## Expected Product Behaviors

- Pilot readiness shows which workflows are ready, unavailable, deferred, or blocked by external credentials/activation, without implying live provider/ABDM/AWS readiness that is not proven.
- Full clinic-day regression covers the implemented workflow chain from lead through owner dashboard using synthetic/simulator evidence and canonical route families.
- Role and tenant safety remains strict across owner, doctor, assistant, receptionist, accountant, auditor, and platform/admin support boundaries.
- Provider unavailable/no-key states stay honest and action-oriented; simulator readiness is never presented as production readiness.
- User-facing temporary UI states remain reachable, responsive, and safe at 390px mobile width and desktop.
- Release notes and runbooks make go-live gates, operator actions, training flow, support escalation, and deferred whole workflows explicit.

## Accepted Non-Goals

- No live provider, ABDM, AWS, GitHub push, or physical-device verification unless credentials/access are supplied and explicitly approved.
- No final visual redesign pass. CP10 fixes safety, clarity, responsiveness, and honest states; final aesthetics remain a separate design effort.
- No partial new clinical, billing, messaging, FHIR, ABDM, cloud, or provider workflows. Defer whole workflows rather than weakening them.
- No real PHI in fixtures, screenshots, release docs, restore evidence, or demos.

## Merge Order

Pilot Configuration -> UX Polish -> End-To-End QA -> Operations/Docs -> master integration patch.

## End-To-End QA Lane Evidence

Pending integration review, the End-To-End QA lane owns these CP10 evidence artifacts:

- `fixtures/synthetic/cp10/clinic_day_regression_flow.json`
- `scripts/validate-cp10-fixtures.mjs`
- `scripts/cp10-contract-smoke.mjs`
- `tests/acceptance/cp10-fixture-contract.test.mjs`
- `tests/e2e/checkpoint-10-clinic-day-flow.spec.ts`
- `docs/qa/checkpoint-10-end-to-end-qa.md`

The harness is synthetic/local-test only. It covers implemented route families from lead through owner dashboard, verifies role and tenant boundaries, records provider unavailable/no-credential checks, references CP7 migration dry-run and CP9 restore dry-run evidence, and keeps deferred workflows out of passed evidence.
