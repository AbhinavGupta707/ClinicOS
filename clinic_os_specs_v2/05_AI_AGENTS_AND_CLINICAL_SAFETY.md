# 05 - AI Agents and Clinical Safety

**Date:** 2026-07-06

## 1. AI product philosophy

AI should remove clerical burden, not replace clinical judgment. The core pattern is:

```text
capture -> transcribe -> structure -> validate -> draft -> human review -> signed record -> workflow triggers
```

No AI-generated diagnosis, prescription, or treatment plan is final until reviewed and signed by the doctor.

## 2. AI capabilities by phase

| Capability | Phase | Notes |
|---|---:|---|
| Message classification | First production slice | Appointment intent, report upload, payment query, recall reply. |
| Appointment reply drafts | First production slice / later automation | Assistant approves or uses configured auto-rule. |
| Clinical scribe | P1 | Consent-gated; doctor signs note. |
| Dental chart extraction | P1 | Voice-to-tooth findings; assistant/doctor verify. |
| Prescription draft | P1 | Template-based; doctor signs. |
| Post-op instruction draft | P1 | From approved clinic templates. |
| Report/document parser | P1 | Extract metadata/summary; doctor verifies. |
| Recall agent | P1 | Finds due patients; staff approves campaigns. |
| Payment follow-up agent | P1 | Low-risk reminders with approval policy. |
| Inventory/lab assistant | P1/P2 | Suggests reorder and lab reconciliation. |
| Owner analyst | P2 | Explains operational leakage and trends. |
| Image diagnostic AI | Not in first production release | Requires clinical validation/regulatory review. |

## 3. Consent model for AI

Before recording or ambient scribing:

- Patient must be informed that conversation may be recorded/transcribed to assist documentation.
- Clinic must configure audio retention policy.
- Patient can decline AI/audio recording without being denied care.
- UI must show consent status clearly before recording starts.
- If consent is revoked, stop capture and follow retention/deletion rules.

Consent records should include:

- Patient ID.
- Consent type: audio transcription, AI documentation, photo capture, photo sharing, ABDM sharing, marketing/recall communication.
- Version of consent text.
- Timestamp.
- Captured by.
- Method: digital form, OTP, staff attestation, written upload.
- Revocation status.

## 4. Scribe pipeline

### Step 1: Capture

- Audio stream from browser/mobile app.
- Low-latency realtime transcription if available.
- Fallback uploaded recording for non-realtime processing.
- Diarization where possible: doctor, patient, assistant.

### Step 2: Transcript processing

- Chunk transcript with timestamps.
- Redact or mark sensitive non-clinical content where feasible.
- Attach encounter and patient context.
- Store transcript segments with provenance.

### Step 3: Structured extraction

Run structured extraction into schemas:

- `ClinicalNoteDraft`
- `MedicalHistoryUpdateDraft`
- `DentalChartPatch`
- `TreatmentPlanDraft`
- `PrescriptionDraft`
- `PostOpInstructionDraft`
- `TaskDrafts`
- `BillingSuggestionDraft`
- `RecallRuleDraft`

### Step 4: Validation

- JSON schema validation.
- Tooth number validation.
- Required clinical section validation.
- Medication/allergy checks where configured.
- Source-anchor check: important assertions must point to transcript/document/source.
- Confidence scoring.
- Flag low-confidence items.

### Step 5: Review UI

- Doctor/assistant sees suggested changes.
- User can accept, edit, reject, or request regeneration.
- Signed clinical note stores final text and source references.
- AI output remains linked for audit/evaluation.

## 5. Agent catalogue

| Agent | Role | Inputs | Outputs | Approval needed |
|---|---|---|---|---|
| Front-desk agent | Classifies inbound messages/calls and drafts replies | WhatsApp/call text, schedule | Appointment tasks/replies | Assistant except configured confirmations |
| Recall agent | Finds due patients and drafts recall campaigns | Last visit, recall rules, opt-in | Recall tasks/messages | Assistant/owner for bulk |
| Scribe agent | Creates clinical note draft | Transcript, templates, history | Structured note | Doctor |
| Dental chart agent | Converts spoken findings to chart patch | Transcript, current chart | Tooth findings | Assistant/doctor |
| Treatment-plan agent | Drafts treatment phases/estimate | Chart, diagnosis, pricebook | Plan/estimate | Doctor/assistant |
| Prescription agent | Drafts prescription from templates/context | Diagnosis, templates, allergies | MedicationRequest draft | Doctor |
| Instruction agent | Sends approved post-op instructions | Procedure, templates | Message/PDF draft | Doctor/template + assistant |
| Payment agent | Creates payment reminder suggestions | Invoice/payment status | Message/task | Assistant or auto-rule |
| Lab agent | Tracks lab cases and reconciliation | Treatment plan, lab case status | Tasks/reports | Assistant |
| Inventory agent | Suggests stock movement/reorders | Procedures, stock ledger | Reorder/task | Assistant/owner |
| Quality agent | Detects missed SOPs/events | Tasks, incidents, logs | Event/CAPA suggestions | Owner/manager |
| Owner analyst | Explains trends/leakage | KPI tables, events | Narrative insights | Owner reads; no direct mutation |

## 6. Tool permission matrix

| Tool/action | AI can suggest | AI can execute automatically | Required approval |
|---|---:|---:|---|
| Create appointment draft | Yes | Sometimes | Assistant/configured rule |
| Send appointment confirmation | Yes | Yes if configured | Assistant/configured rule |
| Send recall campaign | Yes | No by default | Assistant/owner |
| Create clinical note draft | Yes | Draft only | Doctor signs |
| Modify dental chart | Yes | Draft only | Assistant/doctor approves |
| Add diagnosis | Yes | No | Doctor |
| Create prescription | Yes | Draft only | Doctor signs |
| Send prescription | No until signed | After signed if configured | Doctor sign-off |
| Generate invoice draft | Yes | No by default | Assistant/doctor workflow |
| Create payment link | Yes | Yes after invoice approved | Assistant/configured rule |
| Mark payment paid | No | Only from verified payment webhook | System after verification |
| Decrement inventory | Suggest/default | Auto only after configured procedure rule | Assistant review for first production release |
| Create lab case | Yes | No by default | Assistant/doctor |
| Export patient record | No | No | Authorized user + audit |
| Delete patient data | No | No | Admin/legal workflow |

## 7. Example structured output schemas

### `DentalChartPatch`

```json
{
  "type": "object",
  "required": ["encounter_id", "findings", "source_segments"],
  "properties": {
    "encounter_id": { "type": "string" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["tooth_number", "finding_type", "status", "confidence"],
        "properties": {
          "tooth_number": { "type": "string", "pattern": "^[1-8][1-8]$" },
          "surface": { "type": ["string", "null"] },
          "finding_type": { "type": "string" },
          "description": { "type": "string" },
          "severity": { "type": ["string", "null"] },
          "status": { "type": "string", "enum": ["active", "watch", "treated", "historical"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "source_segment_ids": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } },
    "source_segments": { "type": "array", "items": { "type": "string" } }
  }
}
```

### `ClinicalNoteDraft`

```json
{
  "type": "object",
  "required": ["chief_complaint", "history", "examination", "assessment", "plan", "confidence"],
  "properties": {
    "chief_complaint": { "type": "string" },
    "history": { "type": "string" },
    "medical_history_changes": { "type": "array", "items": { "type": "string" } },
    "examination": { "type": "string" },
    "investigations": { "type": "array", "items": { "type": "string" } },
    "assessment": { "type": "string" },
    "plan": { "type": "string" },
    "procedures_performed": { "type": "array", "items": { "type": "string" } },
    "follow_up": { "type": ["string", "null"] },
    "requires_doctor_attention": { "type": "array", "items": { "type": "string" } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

## 8. Prompting principles

- Use clinic-approved note templates.
- Use structured outputs with strict JSON schemas.
- Provide patient context only as needed for the task.
- Require source anchors for clinical claims.
- Ask the model to explicitly return uncertainty/warnings.
- Separate extraction from recommendation.
- Keep diagnosis/treatment suggestion features conservative and optional.

## 9. AI evaluation plan

### Datasets

- 50-100 de-identified dental encounter transcripts from pilots, with consent.
- Synthetic transcripts for early testing.
- Manually labelled tooth findings.
- Gold-standard clinical note sections.
- Gold-standard task/billing/lab/recall outputs.

### Metrics

| Metric | Target direction |
|---|---|
| Note acceptance rate | Higher |
| Average doctor edit time | Lower |
| Tooth extraction precision | High priority |
| Tooth extraction recall | High priority but false positives dangerous |
| Unsupported assertion rate | Near zero |
| Prescription draft correction rate | Low before wider rollout |
| Average scribe latency | Low enough for clinic use |
| Cost per encounter | Within pricing model |
| Patient consent opt-in rate | Monitor |

### Safety tests

- Hallucinated diagnosis injection.
- Wrong tooth number extraction.
- Misheard medication/allergy.
- Mixed Hindi/English dental conversation.
- Patient asks unrelated question.
- Background staff conversation.
- Noisy clinic audio.
- Assistant/doctor correction mid-visit.
- Multiple patients accidentally captured.

## 10. PHI and AI vendor controls

- Do not log raw PHI in general application logs.
- Encrypt audio/transcripts/AI outputs.
- Configure AI vendors for no-training/no-retention where available and contractually appropriate.
- Prefer regional processing/data-residency options if available and required.
- Maintain AI vendor register and data processing terms.
- Allow tenant-level AI disablement.
- Make raw audio retention configurable and conservative.

## 11. Clinical safety UI requirements

- AI output must be visibly marked as draft.
- Show confidence and warnings.
- Show “source transcript” snippets for important claims.
- Require explicit sign button for clinical note and prescription.
- Keep audit of original draft, edits, and final signed version.
- Allow amendment with reason, not silent overwrite after sign-off.
- Never send prescription/instructions before doctor sign-off.

## 12. AI failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Hallucinated clinical fact | Source anchors, unsupported assertion detector, doctor review. |
| Wrong tooth number | FDI validation, UI confirmation, assistant review. |
| Misheard medication/allergy | Medication/allergy confirmation prompts and doctor sign-off. |
| Patient did not consent | Capture disabled until consent recorded. |
| Raw audio retained too long | Default deletion policy and retention jobs. |
| AI sends wrong message | Approval policies and template restrictions. |
| Cost spikes | Usage budgets, per-tenant limits, model routing. |
| Vendor outage | Fallback manual mode and queued processing. |


## 11. v0.2 AI architecture: agent harness and action proposals

The AI layer is updated from “scribe plus agents” to a governed agent harness. Agents may observe context and propose actions, but sensitive actions require approval and all actions are executed by typed tools with audit logs.

### 11.1 Agent categories

| Agent | Primary role | Output type |
|---|---|---|
| Lead triage agent | Classifies WhatsApp/call/Practo/Google inbound demand | Lead intent + suggested action |
| Scheduling agent | Suggests slots and drafts confirmation/reschedule messages | ActionProposal: create appointment / send message |
| Recall agent | Finds due recalls and drafts campaigns | ActionProposal: send recall messages |
| Scribe agent | Converts consultation into structured note draft | ClinicalDraft |
| Dental chart agent | Converts spoken findings into tooth-level chart patch | DentalChartPatch draft |
| Treatment plan agent | Drafts staged plan, estimate, consent checklist | TreatmentPlanDraft |
| Payment agent | Drafts payment reminders and links | ActionProposal: create payment link / send reminder |
| Lab agent | Creates/checks lab cases from encounter context | ActionProposal: create/update lab case |
| Inventory agent | Suggests stock decrement/reorder/checklist tasks | ActionProposal: adjust stock / create task |
| Owner analyst agent | Explains leakage and source ROI | Analytics narrative, no direct mutation |

### 11.2 Tool execution model

```text
Event/context -> Agent -> ActionProposal -> Policy Engine -> Approval UI -> Tool Executor -> Audit/Event Log
```

Agents cannot directly call external providers such as WhatsApp, payment gateways, ABDM, or Practo. They call internal tools that enforce permissions and approval policies.

### 11.3 Approval policy examples

| Proposed action | Required approval |
|---|---|
| Classify lead intent | None; reversible metadata |
| Draft appointment reply | Assistant approval unless configured auto-reply for low-risk template |
| Send appointment confirmation | Auto if patient booked and template is approved |
| Create appointment | Assistant approval unless initiated by patient self-booking rule |
| Draft clinical note | Doctor approval |
| Apply dental chart patch | Doctor/assistant edit, doctor final sign-off |
| Send prescription | Doctor signature required |
| Send post-op instruction | Doctor-approved template; assistant can send after encounter |
| Create invoice | Assistant/doctor/owner approval depending clinic config |
| Create payment link | Assistant approval or auto after invoice approval |
| Send bulk recall campaign | Owner/assistant approval |
| Adjust inventory | Assistant confirmation unless default material rule is configured |

### 11.4 Evidence and provenance

Every AI draft/action must store evidence:

- Source message/call/transcript/document ID.
- Transcript time range where applicable.
- Patient and encounter context used.
- Prompt/template version.
- Model/provider/version.
- Structured output schema version.
- User edits and final signed content.

### 11.5 Safety posture

AI is allowed to automate clerical work and generate drafts. It is not allowed to autonomously diagnose, prescribe, finalize treatment, or represent that a doctor approved something before sign-off.

### 11.6 Plena-style customization without unsafe autonomy

The product should support rapid clinic-specific workflows through configuration:

- Workflow definitions.
- Clinic templates.
- Approval policies.
- Agent tools.
- Specialty schema extensions.

Do not create unreviewed free-form autonomous agents. Use bounded tools and schemas.
