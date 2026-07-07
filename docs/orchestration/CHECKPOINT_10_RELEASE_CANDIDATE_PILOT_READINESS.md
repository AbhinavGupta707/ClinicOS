# Checkpoint 10 - Release Candidate And Pilot Rollout Readiness

- Launch date: 2026-07-07
- Launch base: `a2d6501`
- Source plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md` section 18
- Integration branch: `codex/integration/checkpoint-10`

## Outcome

Target outcome: after master verification, ClinicOS can be treated as a
release-candidate package for a selected pilot clinic. Pilot configuration must
be explicit, user-facing rough edges must be honest and responsive, end-to-end
regression evidence must cover the full dental-first clinic day, and
operations/support/docs must identify go-live gates and deferred whole workflows
without weakening shipped behavior.

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

## Operations/Docs Lane Draft Deliverables

The Operations/Docs lane provides the release-candidate documentation package
for master completion. These documents are drafts until the master integration
pass records final verification evidence:

- `docs/release/checkpoint-10-release-notes.md` - release-candidate scope,
  operator-visible changes, and explicit live-verification boundaries.
- `docs/release/pilot-go-live-checklist.md` - hard go/no-go gates, timeline,
  rollback/degraded-mode posture, and clinic sign-off table.
- `docs/training/pilot-training-flow.md` - owner, doctor, assistant,
  receptionist, accountant, and support/admin training tasks.
- `infra/runbooks/pilot-support-admin.md` - incident intake, support escalation,
  provider no-key handling, and degraded-mode playbooks.
- `docs/release/known-risks-deferred-work.md` - live gaps, deferred whole
  workflows, and operational risks that must not be papered over.
- `docs/qa/checkpoint-10-evidence-matrix.md` - evidence slots for code,
  clinic-day, role/tenant, browser, provider, backup, and manual smoke gates.
- `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md` - final report skeleton for
  master verification and go/no-go closeout.

Operations/Docs does not move CP10 to complete. Master must fill the final
report with actual lane commits, checks, browser/user evidence, accepted gaps,
and go/no-go decisions after all lanes are merged.
