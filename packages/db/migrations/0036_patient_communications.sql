-- PostgreSQL ARE repeat bounds stop at 255; the existing {1,512}
-- template-name CHECK raises an error even for short valid provider names.
alter table meta_whatsapp_template_snapshots drop constraint meta_whatsapp_template_snapshots_template_name_check;
alter table meta_whatsapp_template_snapshots add constraint meta_whatsapp_template_snapshots_template_name_check check(length(template_name) between 1 and 512 and template_name ~ '^[a-z0-9_]+$');
alter table meta_whatsapp_outbound_messages drop constraint meta_whatsapp_outbound_messages_template_name_check;
alter table meta_whatsapp_outbound_messages add constraint meta_whatsapp_outbound_messages_template_name_check check(length(template_name) between 1 and 512 and template_name ~ '^[a-z0-9_]+$');

create unique index communication_template_scope on meta_whatsapp_template_snapshots(tenant_id,clinic_id,id);
create unique index leads_communication_scope_id on leads(tenant_id,clinic_id,id);
create table communication_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  clinic_id uuid not null,
  external_account_id uuid not null,
  contact text not null check(contact ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'open' check(status in ('open','waiting','handled')),
  assigned_user_id uuid references users(id) on delete restrict,
  patient_id uuid,
  lead_id uuid,
  row_version bigint not null default 1 check(row_version between 1 and 9007199254740991),
  latest_sequence bigint not null default 0 check(latest_sequence between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,clinic_id,id),
  unique(tenant_id,clinic_id,external_account_id,contact),
  foreign key(tenant_id,clinic_id,external_account_id) references external_accounts(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,patient_id) references patients(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,lead_id) references leads(tenant_id,clinic_id,id)
);
create index communication_threads_page on communication_threads(tenant_id,clinic_id,created_at desc,id desc);

create table communication_reads (
  tenant_id uuid not null, clinic_id uuid not null, thread_id uuid not null,
  user_id uuid not null references users(id),
  through_sequence bigint not null check(through_sequence between 0 and 9007199254740991),
  primary key(tenant_id,clinic_id,thread_id,user_id),
  foreign key(tenant_id,clinic_id,thread_id) references communication_threads(tenant_id,clinic_id,id)
);

create table communication_template_definitions (
  tenant_id uuid not null, clinic_id uuid not null, template_id uuid not null,
  sync_job_id uuid not null,
  sync_status text not null check(sync_status in ('queued','ready','unsupported','failed')),
  snapshot_version bigint,
  body text check(length(body)<=1024),
  definition_digest char(64),
  verified_at timestamptz,
  primary key(tenant_id,clinic_id,template_id),
  foreign key(tenant_id,clinic_id,template_id) references meta_whatsapp_template_snapshots(tenant_id,clinic_id,id),
  check(sync_status<>'ready' or (body is not null and definition_digest ~ '^[a-f0-9]{64}$' and verified_at is not null and snapshot_version is not null))
);

create table communication_requests (
  id uuid primary key,
  tenant_id uuid not null, clinic_id uuid not null, thread_id uuid not null,
  patient_id uuid not null, appointment_id uuid not null, template_id uuid not null,
  approved_snapshot jsonb not null check(jsonb_typeof(approved_snapshot)='object' and octet_length(approved_snapshot::text)<16384),
  approval_digest char(64) not null check(approval_digest ~ '^[a-f0-9]{64}$'),
  approved_by_user_id uuid not null references users(id),
  approved_at timestamptz not null, expires_at timestamptz not null,
  status text not null default 'queued' check(status in ('queued','sending','accepted','not_dispatched','ambiguous','rejected','blocked','cancelled')),
  failure_code text,
  outbox_event_id uuid not null,
  unique(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,thread_id) references communication_threads(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,patient_id) references patients(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,appointment_id,patient_id) references appointments(tenant_id,clinic_id,id,patient_id),
  foreign key(tenant_id,clinic_id,template_id) references meta_whatsapp_template_snapshots(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,outbox_event_id) references outbox_events(tenant_id,clinic_id,id) deferrable initially deferred
);
create index communication_requests_thread on communication_requests(tenant_id,clinic_id,thread_id,approved_at desc,id desc);

create table communication_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, clinic_id uuid not null, thread_id uuid not null,
  sequence bigint not null check(sequence between 1 and 9007199254740991),
  kind text not null check(kind in ('inbound','manual_contact','appointment_request')),
  receipt_id uuid, request_id uuid,
  manual_evidence text check(length(manual_evidence) between 1 and 2000),
  recorded_by_user_id uuid references users(id),
  occurred_at timestamptz not null, recorded_at timestamptz not null default now(),
  unique(tenant_id,clinic_id,id), unique(tenant_id,clinic_id,thread_id,sequence),
  unique(tenant_id,clinic_id,receipt_id), unique(tenant_id,clinic_id,request_id),
  foreign key(tenant_id,clinic_id,thread_id) references communication_threads(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,receipt_id) references meta_whatsapp_event_receipts(tenant_id,clinic_id,id),
  foreign key(tenant_id,clinic_id,request_id) references communication_requests(tenant_id,clinic_id,id),
  check((kind='inbound' and receipt_id is not null and request_id is null and manual_evidence is null and recorded_by_user_id is null)
     or (kind='manual_contact' and receipt_id is null and request_id is null and manual_evidence is not null and recorded_by_user_id is not null)
     or (kind='appointment_request' and receipt_id is null and request_id is not null and manual_evidence is null and recorded_by_user_id is not null))
);
create trigger communication_messages_immutable before update or delete on communication_messages
  for each row execute function clinic_os.reject_import_run_mutation();

create function clinic_os.preserve_communication_approval() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' or (new.id,new.tenant_id,new.clinic_id,new.thread_id,new.patient_id,new.appointment_id,new.template_id,new.approved_snapshot,new.approval_digest,new.approved_by_user_id,new.approved_at,new.expires_at,new.outbox_event_id)
    is distinct from (old.id,old.tenant_id,old.clinic_id,old.thread_id,old.patient_id,old.appointment_id,old.template_id,old.approved_snapshot,old.approval_digest,old.approved_by_user_id,old.approved_at,old.expires_at,old.outbox_event_id) then
    raise exception 'Communication approval evidence is immutable';
  end if;
  return new;
end $$;
create trigger communication_approval_immutable before update or delete on communication_requests
  for each row execute function clinic_os.preserve_communication_approval();

-- Join only the existing verified receipt boundary. No public message-ingestion route.
create function clinic_os.project_communication_receipt() returns trigger language plpgsql as $$
declare payload jsonb; contact_value text; thread_key uuid; seq bigint;
begin
  if new.event_kind<>'inbound_message' or new.application_outcome<>'applied' then return new; end if;
  if exists(select 1 from communication_messages where tenant_id=new.tenant_id and clinic_id=new.clinic_id and receipt_id=new.id) then return new; end if;
  select normalized_payload into payload from normalized_integration_events
    where tenant_id=new.tenant_id and clinic_id=new.clinic_id and id=new.normalized_event_id and event_type='inbound_message';
  contact_value := '+' || (payload->>'senderWaId');
  -- Non-phone WhatsApp addressing is outside this slice, retained in provider evidence.
  if contact_value is null or contact_value !~ '^\+[1-9][0-9]{7,14}$' then return new; end if;
  insert into communication_threads(tenant_id,clinic_id,external_account_id,contact)
    values(new.tenant_id,new.clinic_id,new.external_account_id,contact_value)
    on conflict(tenant_id,clinic_id,external_account_id,contact) do nothing;
  select id into thread_key from communication_threads where tenant_id=new.tenant_id and clinic_id=new.clinic_id
    and external_account_id=new.external_account_id and contact=contact_value for update;
  if exists(select 1 from communication_messages where tenant_id=new.tenant_id and clinic_id=new.clinic_id and receipt_id=new.id) then return new; end if;
  update communication_threads set latest_sequence=latest_sequence+1,row_version=row_version+1,status='open',updated_at=now()
    where tenant_id=new.tenant_id and clinic_id=new.clinic_id and id=thread_key returning latest_sequence into seq;
  insert into communication_messages(tenant_id,clinic_id,thread_id,sequence,kind,receipt_id,occurred_at)
    values(new.tenant_id,new.clinic_id,thread_key,seq,'inbound',new.id,new.provider_occurred_at);
  return new;
end $$;
create trigger communication_receipt_applied after update of application_outcome on meta_whatsapp_event_receipts
  for each row execute function clinic_os.project_communication_receipt();
-- Existing verified events become visible without requiring provider retransmission.
-- Migration owner only; restored in the same transactional migration. Runtime RLS stays enforced.
alter table meta_whatsapp_event_receipts no force row level security;
alter table normalized_integration_events no force row level security;
update meta_whatsapp_event_receipts set application_outcome=application_outcome
  where event_kind='inbound_message' and application_outcome='applied';
alter table meta_whatsapp_event_receipts force row level security;
alter table normalized_integration_events force row level security;

do $$ declare name text; begin
  foreach name in array array['communication_threads','communication_reads','communication_template_definitions','communication_requests','communication_messages'] loop
    execute format('alter table %I enable row level security',name);
    execute format('alter table %I force row level security',name);
    execute format('create policy communication_scope on %I using(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id()) with check(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id())',name);
  end loop;
end $$;
