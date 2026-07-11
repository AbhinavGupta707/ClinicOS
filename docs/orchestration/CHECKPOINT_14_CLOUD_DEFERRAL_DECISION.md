# CP14 Owner-Directed Cloud Deferral

**Decision date:** 2026-07-11

**Authority:** ClinicOS owner

**Implementation baseline:** `ba80612fd139bcf3fa3014823cbf0fb075eceac8`

**Release decision:** **NO-GO** for production, PHI, official provider traffic or clinical reliance

## Decision

AWS spending and all AWS/DNS activation are deferred until the owner separately reopens them. Do
not run Terraform plan/apply against AWS, create or destroy cloud resources, publish ECR images,
delegate DNS, issue deployed certificates, enable GuardDuty, configure live paging, or run a cloud
restore/failover drill as part of the current implementation sequence.

This is an execution deferral, not evidence that CP14's E4/E5 exit gate passed. CP14 is recorded as
**implementation-complete at E3 with cloud activation deferred**. Its production-readiness findings
remain open in the remediation register.

## Safe forward progress

The CP14 candidate freezes typed configuration and provider contracts for Terraform outputs,
identity/session security, private media, GuardDuty evidence, telemetry, signed callbacks,
degraded/unavailable states and recovery procedures. That is sufficient to continue:

- CP15 provider adapter, raw-signature callback, deduplication, reconciliation, provider-health,
  operations UI and deterministic adversarial-test implementation;
- CP16 mobile, consent, offline, AI safety, FHIR/ABDM boundary and unavailable-state
  implementation where those lanes have stable non-cloud inputs;
- local, database, contract, container, security, browser and synthetic verification.

Later code must consume the frozen contracts and fail closed when deployment/provider inputs are
absent. It must not introduce a local-only production path, fake callback success, substitute a
simulator for provider evidence, or weaken tenant, audit, media quarantine or signature controls.

## Evidence that remains blocked

The following cannot be claimed or closed until AWS activation is explicitly reopened:

- applied staging and pilot-production inventories, drift and reachability;
- signed dual-region ECR artifacts and deployed provenance;
- deployed RDS/Redis/ECS/Keycloak/Temporal/ALB/WAF/DNS/TLS behavior;
- live GuardDuty media scanning, paging, telemetry, load/fault and restore/failover evidence;
- stable public HTTPS endpoints for official Meta, Razorpay or telephony callback registration;
- CP17 E5/E6 pilot validation and CP18 E7 observed multi-clinic operations.

Official-provider and physical-device activation may introduce separate external blockers even
after local implementation is complete.

## Advancement policy

The verified CP14 E3 implementation baseline may be promoted to `main` with this deferral record,
and CP15/selected CP16 **implementation waves** may proceed sequentially. This does not rename an
open evidence gate as complete:

- CP14 remains cloud-evidence deferred;
- CP15 cannot reach official-sandbox E4 without stable deployed HTTPS callbacks;
- CP16 can close only the boundaries that achieve their required device/provider/validator tier;
- CP17 and CP18 remain blocked and must not be represented as completed.

Every later report must carry the release **NO-GO** and link this decision until superseded.

## Re-entry gate

Before any future AWS activation, obtain a fresh owner instruction, reauthenticate the exact AWS
account, review a current saved Terraform plan and cost estimate, confirm the paging destination,
DNS/private-admin approach, GuardDuty scope and recovery window, then execute staging before any
pilot-production action. All affected E4/E5 tests must run against the exact later revision; this
E3 record cannot be promoted retroactively.
