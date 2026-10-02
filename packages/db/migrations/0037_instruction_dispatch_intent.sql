-- New requests bind the recipient the author addressed. Historical requests are
-- deliberately left without a snapshot: migration must not invent authorization.
alter table patient_instruction_requests add column dispatch_recipient_phone text;

create function clinic_os.capture_instruction_recipient() returns trigger language plpgsql as $$
begin
  if new.channel='whatsapp' then
    select phone into new.dispatch_recipient_phone from patients
      where tenant_id=new.tenant_id and clinic_id=new.clinic_id and id=new.patient_id for share;
  else
    new.dispatch_recipient_phone := null;
  end if;
  return new;
end $$;
create trigger capture_instruction_recipient before insert on patient_instruction_requests
  for each row execute function clinic_os.capture_instruction_recipient();

create function clinic_os.preserve_instruction_intent() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Instruction request evidence is immutable'; end if;
  if (new.id,new.tenant_id,new.clinic_id,new.patient_id,new.channel,new.template_id,new.title,new.body,
      new.status,new.rendered_at,new.print_job_id,new.created_by_user_id,new.created_at,new.dispatch_recipient_phone)
    is distinct from
     (old.id,old.tenant_id,old.clinic_id,old.patient_id,old.channel,old.template_id,old.title,old.body,
      old.status,old.rendered_at,old.print_job_id,old.created_by_user_id,old.created_at,old.dispatch_recipient_phone)
    or (old.outbox_event_id is not null and new.outbox_event_id is distinct from old.outbox_event_id) then
    raise exception 'Instruction request evidence is immutable';
  end if;
  if new.outbox_event_id is distinct from old.outbox_event_id and not exists (
    select 1 from outbox_events e where e.tenant_id=new.tenant_id and e.clinic_id=new.clinic_id
      and e.id=new.outbox_event_id and e.event_type='instruction.send_requested'
      and e.aggregate_type='patient_instruction' and e.aggregate_id=new.id
      and e.patient_id=new.patient_id and e.actor_type='user' and e.actor_id=new.created_by_user_id::text
  ) then raise exception 'Instruction action does not match its author and patient'; end if;
  return new;
end $$;
create trigger preserve_instruction_intent before update or delete on patient_instruction_requests
  for each row execute function clinic_os.preserve_instruction_intent();

-- Bind retries to the first claimed consent/account/template evidence.
alter table meta_whatsapp_outbound_messages add column instruction_source_digest char(64)
  check(instruction_source_digest is null or instruction_source_digest ~ '^[a-f0-9]{64}$');

-- Proven non-dispatch remains factual even after the bounded retry budget ends.
-- Other senders retain their existing retry invariant.
alter table meta_whatsapp_outbound_messages
  drop constraint meta_whatsapp_outbound_retry_truth_check,
  add constraint meta_whatsapp_outbound_retry_truth_check check (
    (dispatch_outcome='not_dispatched' and not reconciliation_required and
      (automatic_retry_allowed or (purpose='care_instruction' and dispatch_attempt_count>=3)))
    or (dispatch_outcome='dispatch_ambiguous' and not automatic_retry_allowed and reconciliation_required)
    or (dispatch_outcome not in ('not_dispatched','dispatch_ambiguous') and not automatic_retry_allowed)
  );
-- Flyway owns this table; its transaction retains the exclusive schema lock.
-- Temporarily lift owner RLS enforcement for the bounded backfill, then restore.
alter table meta_whatsapp_outbound_messages no force row level security;
update meta_whatsapp_outbound_messages set automatic_retry_allowed=false
  where purpose='care_instruction' and dispatch_outcome='not_dispatched' and dispatch_attempt_count>=3;

alter table meta_whatsapp_outbound_messages force row level security;
