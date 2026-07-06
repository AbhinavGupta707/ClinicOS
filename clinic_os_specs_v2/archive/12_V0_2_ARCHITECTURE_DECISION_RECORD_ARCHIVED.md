# 12 - v0.2 Architecture Decision Record: Practo, Plena, and Overlay-to-OS Strategy

**Date:** 2026-07-06  
**Status:** Accepted for next build pack revision

## 1. Decision summary

The architecture changes materially after the Practo/Plena analysis.

The product should be built as:

```text
Layer 1: Automation Overlay
  Connects to existing tools, captures external demand, performs admin work, and routes tasks.

Layer 2: Replacement-Grade Clinic OS
  Replaces Ray-like software workflows: schedule, queue, records, notes, prescriptions, billing, payments, reminders, recalls, tasks, analytics.

Layer 3: Specialty Operating Layer
  Starts with dental: odontogram, perio, X-rays/photos, treatment plans, lab cases, materials, preventive recall.
```

The product should be **built like a replacement, sold like an overlay, migrated like a partner**.

## 2. Why this changed

The original plan already avoided a marketplace clone and mentioned coexistence. That was directionally correct but underspecified. The revised architecture makes coexistence/replacement an explicit technical design:

- Practo Ray-like functionality should be rebuilt and replaced.
- Practo Prime/Profile/marketplace demand should coexist initially.
- Practo API access should be treated as uncertain, not assumed.
- Practo-originated patients should flow into ClinicOS as source-attributed leads/bookings.
- Over time, ClinicOS should reduce Practo dependence through direct booking, Google reviews, recall campaigns, referrals, and source ROI analytics.

## 3. Plena-derived product/architecture lessons

Plena's public YC materials describe an AI operating layer for specialty practices that automates administrative workflows across existing systems rather than forcing a rip-and-replace. The useful architectural lessons are:

- The real target is not “better software screens”; it is taking work off staff.
- Start with one painful workflow and expand.
- Use reusable workflow primitives, integration adapters, and agent harnesses.
- Avoid forcing staff into another portal before value is proven.
- Over time, the operating layer can cannibalize the stitched-together vendor stack.

For India, this means the early wedge should automate the assistant's day: WhatsApp, missed calls, confirmations, recalls, lab cases, dues, treatment-plan follow-ups, inventory tasks, and doctor prep.

## 4. Practo strategy

### Replace from day one

| Practo/Ray-like workflow | ClinicOS stance |
|---|---|
| Appointment calendar | Replace as operational source of truth |
| Queue/walk-ins | Replace |
| Patient profile | Replace for new records; import history where possible |
| Clinical notes/templates | Replace |
| Dental charting | Replace and go deeper |
| Prescriptions | Replace with doctor-signed drafts/templates |
| Billing/payments/dues | Replace |
| Reminders/post-consult communication | Replace with WhatsApp-first workflow |
| Records/doc sharing | Replace with richer media/document timeline |
| Reports/analytics | Replace and deepen around owner leakage |

### Coexist initially

| Practo/Growth layer | ClinicOS stance |
|---|---|
| Practo Prime/Profile | Keep if it generates patients |
| Practo marketplace/search | Treat as acquisition source |
| Practo reviews/patient stories | Track as channel asset; do not rebuild initially |
| Practo Consult | Optional coexistence if clinic actively uses it |

## 5. Technical consequences

The following objects become first-class:

- `ExternalSystem`
- `ExternalAccount`
- `ExternalPatientLink`
- `ExternalAppointmentLink`
- `LeadSource`
- `AttributionTouch`
- `MigrationBatch`
- `IntegrationWebhookEvent`
- `WorkflowPrimitive`
- `WorkflowRun`
- `ActionProposal`
- `ApprovalDecision`
- `AgentToolInvocation`
- `SourceOfTruthPolicy`

The system must support:

- Read/import adapters.
- Webhook adapters.
- Manual assisted import.
- Source attribution.
- Dual-running/shadow mode.
- Idempotency and deduplication.
- Agent-generated proposals requiring approval for sensitive actions.
- Clinic-level configuration for whether ClinicOS or an external tool is the source of truth per domain during migration.

## 6. Implementation rule

Do not build brittle or unauthorized scraping as a core dependency. If Practo or another vendor lacks a public API, use legitimate export/import, notifications parsing where contractually allowed, manual entry, or a partner integration path.

## 7. New MVP principle

The MVP is no longer merely:

```text
appointment -> intake -> encounter -> billing -> recall
```

It is:

```text
external demand -> lead inbox -> source attribution -> appointment/queue -> intake -> encounter -> dental chart -> treatment plan -> invoice/payment -> instructions -> recall/lab/inventory/tasks -> owner ROI dashboard
```

This is the version Codex/Claude Code should implement against.
