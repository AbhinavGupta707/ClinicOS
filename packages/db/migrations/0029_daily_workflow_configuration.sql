-- Existing configuration stays authoritative. Versions protect operator edits;
-- deactivation preserves historical appointment, procedure and invoice references.
alter table clinics add column row_version bigint not null default 1 check(row_version>0);
alter table appointment_types add column row_version bigint not null default 1 check(row_version>0);
alter table chairs_or_rooms add column row_version bigint not null default 1 check(row_version>0);
alter table provider_schedules add column row_version bigint not null default 1 check(row_version>0);
alter table pricebook_procedures add column row_version bigint not null default 1 check(row_version>0);
