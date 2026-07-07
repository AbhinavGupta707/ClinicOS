-- Checkpoint 8: consent-gated AI scribe sessions, transcript provenance, draft outputs,
-- review-only action proposals, and retention evidence.
-- Applies after 0008_live_integrations_migration_hardening.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('ai.scribe.read', 'Read AI scribe drafts', 'clinical', 'Read consent-gated AI scribe sessions, transcript anchors, drafts, and review state.', true),
  ('ai.scribe.write', 'Manage AI scribe capture', 'clinical', 'Start consent-gated AI scribe sessions and submit transcript segments for backend processing.', true),
  ('ai.scribe.review', 'Review AI scribe outputs', 'clinical', 'Approve, reject, or request changes for AI drafts and action proposals without automatic clinical application.', true)
on conflict (key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  phi_involved = excluded.phi_involved;

insert into role_permissions (role_id, permission_key)
select roles.id, grants.permission_key
from roles
join (
  values
    ('owner_admin', 'ai.scribe.read'),
    ('owner_admin', 'ai.scribe.write'),
    ('owner_admin', 'ai.scribe.review'),
    ('doctor', 'ai.scribe.read'),
    ('doctor', 'ai.scribe.write'),
    ('doctor', 'ai.scribe.review'),
    ('assistant', 'ai.scribe.read'),
    ('assistant', 'ai.scribe.write'),
    ('assistant', 'ai.scribe.review'),
    ('platform_admin', 'ai.scribe.read'),
    ('platform_admin', 'ai.scribe.write'),
    ('platform_admin', 'ai.scribe.review')
) grants(role_slug, permission_key) on roles.slug = grants.role_slug
on conflict do nothing;

alter table patient_timeline_items drop constraint if exists patient_timeline_items_item_type_check;
alter table patient_timeline_items
  add constraint patient_timeline_items_item_type_check check (
    item_type in (
      'patient_created',
      'attribution_touch_created',
      'lead_created',
      'lead_matched',
      'appointment_created',
      'appointment_confirmed',
      'patient_checked_in',
      'queue_entry_created',
      'appointment_no_show',
      'task_created',
      'task_status_changed',
      'task_completed',
      'recall_due',
      'recall_action_recorded',
      'form_response_submitted',
      'consent_created',
      'consent_revoked',
      'encounter_created',
      'encounter_started',
      'encounter_completed',
      'clinical_note_draft_created',
      'clinical_note_signed',
      'clinical_note_amended',
      'dental_finding_created',
      'dental_finding_updated',
      'dental_chart_snapshot_created',
      'media_uploaded',
      'prescription_draft_created',
      'prescription_signed',
      'instruction_print_requested',
      'instruction_send_requested',
      'treatment_plan_created',
      'treatment_plan_accepted',
      'procedure_completed',
      'invoice_created',
      'payment_recorded',
      'receipt_generated',
      'payment_requested',
      'payment_succeeded',
      'payment_manually_recorded',
      'payment_reconciliation_required',
      'lab_case_created',
      'lab_case_sent',
      'lab_case_returned',
      'lab_case_completed',
      'incident_created',
      'corrective_action_created',
      'corrective_action_completed',
      'ai_session_started',
      'ai_draft_generated',
      'ai_review_decision_recorded',
      'ai_retention_deleted'
    )
  );

create table if not exists ai_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  status text not null default 'capture_ready' check (
    status in ('capture_ready', 'processing', 'ready_for_review', 'blocked', 'retention_deleted', 'cancelled')
  ),
  provider_mode text not null check (provider_mode in ('simulator', 'unconfigured', 'live_disabled')),
  llm_provider_key text not null check (length(trim(llm_provider_key)) > 0),
  transcription_provider_key text not null check (length(trim(transcription_provider_key)) > 0),
  consent_snapshot jsonb not null check (jsonb_typeof(consent_snapshot) = 'object'),
  retention_policy jsonb not null check (jsonb_typeof(retention_policy) = 'object'),
  language_hint text,
  started_by_user_id uuid not null references users(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  raw_audio_deleted_at timestamptz,
  transcript_deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ai_sessions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_sessions_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint ai_sessions_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint ai_sessions_no_provider_training check (
    retention_policy->>'providerTrainingAllowed' = 'false'
  ),
  constraint ai_sessions_digest_only_provider_payloads check (
    retention_policy->>'providerRawPayloadStorage' = 'digest_only'
  )
);

create index if not exists ai_sessions_encounter_idx
  on ai_sessions(tenant_id, clinic_id, encounter_id, started_at desc);
create trigger ai_sessions_set_updated_at
before update on ai_sessions
for each row execute function clinic_os.set_updated_at();

create table if not exists ai_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  sequence integer not null check (sequence > 0),
  speaker_role text not null default 'unknown' check (speaker_role in ('doctor', 'assistant', 'patient', 'unknown')),
  text text not null check (length(trim(text)) > 0),
  starts_at_ms integer not null check (starts_at_ms >= 0),
  ends_at_ms integer not null check (ends_at_ms >= starts_at_ms),
  source_hash text not null check (length(source_hash) = 64),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, session_id, sequence),
  constraint ai_transcript_segments_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_transcript_segments_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade
);

create table if not exists ai_source_anchors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  anchor_type text not null check (
    anchor_type in ('transcript_segment', 'media_asset', 'clinical_context', 'external_document')
  ),
  source_record_type text not null check (length(trim(source_record_type)) > 0),
  source_record_id text not null check (length(trim(source_record_id)) > 0),
  transcript_segment_id uuid,
  starts_at_ms integer check (starts_at_ms is null or starts_at_ms >= 0),
  ends_at_ms integer check (ends_at_ms is null or starts_at_ms is null or ends_at_ms >= starts_at_ms),
  text_quote_digest text check (text_quote_digest is null or length(text_quote_digest) = 64),
  supported boolean not null default true,
  unsupported_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ai_source_anchors_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_source_anchors_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade,
  constraint ai_source_anchors_transcript_fk
    foreign key (tenant_id, transcript_segment_id) references ai_transcript_segments(tenant_id, id) on delete set null,
  constraint ai_source_anchors_supported_reason_check check (
    (supported = true and unsupported_reason is null)
    or (supported = false and unsupported_reason is not null)
  )
);

create index if not exists ai_source_anchors_session_idx
  on ai_source_anchors(tenant_id, clinic_id, session_id, created_at);

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  job_type text not null check (job_type in ('transcription', 'draft_generation', 'retention_delete')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'blocked')),
  provider_mode text not null check (provider_mode in ('simulator', 'unconfigured', 'live_disabled')),
  provider_key text not null check (length(trim(provider_key)) > 0),
  input_digest text not null check (length(input_digest) = 64),
  output_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(output_summary) = 'object'),
  error_code text,
  error_message text,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  constraint ai_jobs_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_jobs_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade
);

create table if not exists ai_draft_outputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  job_id uuid,
  patient_id uuid not null,
  encounter_id uuid not null,
  output_type text not null check (output_type in ('clinical_note_draft', 'dental_chart_patch_draft')),
  review_status text not null default 'needs_review' check (
    review_status in ('needs_review', 'approved_review_only', 'rejected', 'superseded')
  ),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  source_anchor_ids uuid[] not null default '{}',
  unsupported_source_anchor_ids uuid[] not null default '{}',
  schema_version text not null check (length(trim(schema_version)) > 0),
  provider_mode text not null check (provider_mode in ('simulator', 'unconfigured', 'live_disabled')),
  provider_request_digest text not null check (length(provider_request_digest) = 64),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by_user_id uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ai_draft_outputs_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_draft_outputs_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade,
  constraint ai_draft_outputs_job_fk
    foreign key (tenant_id, job_id) references ai_jobs(tenant_id, id) on delete set null
);

create trigger ai_draft_outputs_set_updated_at
before update on ai_draft_outputs
for each row execute function clinic_os.set_updated_at();

create table if not exists ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  output_id uuid,
  patient_id uuid not null,
  encounter_id uuid not null,
  proposal_type text not null check (
    proposal_type in ('create_task', 'draft_patient_message', 'create_billing_follow_up', 'create_lab_case')
  ),
  review_status text not null default 'needs_review' check (
    review_status in ('needs_review', 'approved_review_only', 'rejected', 'superseded')
  ),
  title text not null check (length(trim(title)) > 0),
  description text not null check (length(trim(description)) > 0),
  proposed_payload jsonb not null check (jsonb_typeof(proposed_payload) = 'object'),
  required_permission text not null check (length(trim(required_permission)) > 0),
  source_anchor_ids uuid[] not null default '{}',
  unsupported_source_anchor_ids uuid[] not null default '{}',
  provider_mode text not null check (provider_mode in ('simulator', 'unconfigured', 'live_disabled')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by_user_id uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ai_action_proposals_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_action_proposals_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade,
  constraint ai_action_proposals_output_fk
    foreign key (tenant_id, output_id) references ai_draft_outputs(tenant_id, id) on delete set null
);

create trigger ai_action_proposals_set_updated_at
before update on ai_action_proposals
for each row execute function clinic_os.set_updated_at();

create table if not exists ai_review_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  session_id uuid not null,
  target_type text not null check (target_type in ('draft_output', 'action_proposal')),
  target_id uuid not null,
  decision text not null check (decision in ('approve', 'reject', 'request_changes')),
  reason text not null check (length(trim(reason)) > 0),
  edited_content jsonb check (edited_content is null or jsonb_typeof(edited_content) = 'object'),
  applied_workflow text not null default 'review_only' check (applied_workflow = 'review_only'),
  applied_record_id uuid check (applied_record_id is null),
  reviewed_by_user_id uuid not null references users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ai_review_decisions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint ai_review_decisions_session_fk
    foreign key (tenant_id, session_id) references ai_sessions(tenant_id, id) on delete cascade
);

create index if not exists ai_review_decisions_session_idx
  on ai_review_decisions(tenant_id, clinic_id, session_id, reviewed_at desc);

alter table ai_sessions enable row level security;
alter table ai_sessions force row level security;
drop policy if exists ai_sessions_tenant_clinic_isolation on ai_sessions;
create policy ai_sessions_tenant_clinic_isolation on ai_sessions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_transcript_segments enable row level security;
alter table ai_transcript_segments force row level security;
drop policy if exists ai_transcript_segments_tenant_clinic_isolation on ai_transcript_segments;
create policy ai_transcript_segments_tenant_clinic_isolation on ai_transcript_segments
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_source_anchors enable row level security;
alter table ai_source_anchors force row level security;
drop policy if exists ai_source_anchors_tenant_clinic_isolation on ai_source_anchors;
create policy ai_source_anchors_tenant_clinic_isolation on ai_source_anchors
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_jobs enable row level security;
alter table ai_jobs force row level security;
drop policy if exists ai_jobs_tenant_clinic_isolation on ai_jobs;
create policy ai_jobs_tenant_clinic_isolation on ai_jobs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_draft_outputs enable row level security;
alter table ai_draft_outputs force row level security;
drop policy if exists ai_draft_outputs_tenant_clinic_isolation on ai_draft_outputs;
create policy ai_draft_outputs_tenant_clinic_isolation on ai_draft_outputs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_action_proposals enable row level security;
alter table ai_action_proposals force row level security;
drop policy if exists ai_action_proposals_tenant_clinic_isolation on ai_action_proposals;
create policy ai_action_proposals_tenant_clinic_isolation on ai_action_proposals
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table ai_review_decisions enable row level security;
alter table ai_review_decisions force row level security;
drop policy if exists ai_review_decisions_tenant_clinic_isolation on ai_review_decisions;
create policy ai_review_decisions_tenant_clinic_isolation on ai_review_decisions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table ai_sessions is 'Consent-gated backend-owned AI scribe sessions with provider mode, consent snapshot, and retention policy evidence.';
comment on table ai_transcript_segments is 'Restricted transcript segments for AI scribe processing. Public APIs must not expose provider raw payloads.';
comment on table ai_source_anchors is 'Source provenance anchors used to support AI clinical assertions and action proposals.';
comment on table ai_draft_outputs is 'Review-only AI clinical note and dental chart patch drafts. Approval does not apply clinical records in CP8.';
comment on table ai_action_proposals is 'Review-only action proposals produced by governed AI tools; sensitive actions require explicit workflow execution.';
comment on table ai_review_decisions is 'Human review decisions for AI outputs with applied_workflow locked to review_only.';
