import { lockClinicConfiguration } from "./clinic-setup.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  appointmentMessageParameter,
  communicationPhone,
  type AppointmentMessagePreview,
  type CommunicationCommand,
  type CommunicationConfiguration,
  type CommunicationMessage,
  type CommunicationState,
  type CommunicationThread
} from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";

type Row = Record<string, unknown>;
export class CommunicationConflict extends Error {}
export class CommunicationNotFound extends Error {}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const scopeArgs = (s: RepositoryScope) => [s.tenantId, s.clinicId];
const fail = (message: string): never => {
  throw new CommunicationConflict(message);
};
const threadSelect = `select t.*, p.full_name as patient_name, u.display_name as assigned_name,
  coalesce(r.through_sequence,0)<t.latest_sequence as unread
  from communication_threads t
  left join patients p on p.tenant_id=t.tenant_id and p.clinic_id=t.clinic_id and p.id=t.patient_id
  left join users u on u.id=t.assigned_user_id
  left join communication_reads r on r.tenant_id=t.tenant_id and r.clinic_id=t.clinic_id and r.thread_id=t.id and r.user_id=$3`;
function mapThread(r: Row): CommunicationThread {
  return {
    id: String(r.id),
    accountId: String(r.external_account_id),
    contact: String(r.contact),
    status: r.status as CommunicationState,
    assignedUserId: r.assigned_user_id as string | null,
    assignedName: r.assigned_name as string | null,
    patientId: r.patient_id as string | null,
    patientName: r.patient_name as string | null,
    leadId: r.lead_id as string | null,
    rowVersion: Number(r.row_version),
    latestSequence: Number(r.latest_sequence),
    unread: r.unread === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}
export async function listCommunicationThreads(
  client: SqlQueryClient,
  scope: RepositoryScope,
  filter: { status?: CommunicationState; cursor?: string } = {}
) {
  let anchor: Row | undefined;
  if (filter.cursor) {
    anchor = (
      await client.query<Row>(
        `select id,created_at from communication_threads
      where tenant_id=$1 and clinic_id=$2 and id=$3`,
        [...scopeArgs(scope), filter.cursor]
      )
    ).rows[0];
    if (!anchor)
      throw new CommunicationNotFound(
        "Conversation cursor no longer matches this list. Refresh the inbox."
      );
  }
  const rows = (
    await client.query<Row>(
      `${threadSelect} where t.tenant_id=$1 and t.clinic_id=$2
    and ($4::text is null or t.status=$4) and ($5::timestamptz is null or (t.created_at,t.id)<($5::timestamptz,$6::uuid))
    order by t.created_at desc,t.id desc limit 51`,
      [
        ...scopeArgs(scope),
        scope.actorUserId,
        filter.status ?? null,
        anchor?.created_at ?? null,
        anchor?.id ?? null
      ]
    )
  ).rows;
  return {
    threads: rows.slice(0, 50).map(mapThread),
    nextCursor: rows.length > 50 ? String(rows[49]!.id) : null
  };
}
export async function getCommunicationThread(
  client: SqlQueryClient,
  scope: RepositoryScope,
  id: string,
  now: Date,
  beforeSequence?: number
) {
  const row = (
    await client.query<Row>(`${threadSelect} where t.tenant_id=$1 and t.clinic_id=$2 and t.id=$4`, [
      ...scopeArgs(scope),
      scope.actorUserId,
      id
    ])
  ).rows[0];
  if (!row) throw new CommunicationNotFound("Conversation not found.");
  const messages = (
    await client.query<Row>(
      `select m.*, n.normalized_payload->>'text' as inbound_text,
    n.normalized_payload->>'messageType' as message_type, u.display_name as recorded_by,
    q.approved_snapshot->>'text' as request_text,
    case when o.dispatch_outcome='pending' and o.dispatch_lease_expires_at<=$5::timestamptz then 'ambiguous' else q.status end as dispatch_status,
    o.state as delivery_status,q.failure_code
    from communication_messages m
    left join meta_whatsapp_event_receipts e on e.tenant_id=m.tenant_id and e.clinic_id=m.clinic_id and e.id=m.receipt_id
    left join normalized_integration_events n on n.tenant_id=e.tenant_id and n.clinic_id=e.clinic_id and n.id=e.normalized_event_id
    left join communication_requests q on q.tenant_id=m.tenant_id and q.clinic_id=m.clinic_id and q.id=m.request_id
    left join meta_whatsapp_outbound_messages o on o.tenant_id=q.tenant_id and o.clinic_id=q.clinic_id and o.message_request_id=q.id
    left join users u on u.id=m.recorded_by_user_id
    where m.tenant_id=$1 and m.clinic_id=$2 and m.thread_id=$3 and ($4::bigint is null or m.sequence<$4)
    order by m.sequence desc limit 51`,
      [...scopeArgs(scope), id, beforeSequence ?? null, now.toISOString()]
    )
  ).rows;
  return {
    thread: mapThread(row),
    messages: messages.slice(0, 50).map((m): CommunicationMessage => ({
      id: String(m.id),
      sequence: Number(m.sequence),
      kind: m.kind as CommunicationMessage["kind"],
      text: (m.kind === "inbound"
        ? m.message_type === "text"
          ? m.inbound_text
          : null
        : m.kind === "manual_contact"
          ? m.manual_evidence
          : m.request_text) as string | null,
      unsupportedContent: m.kind === "inbound" && m.message_type !== "text",
      occurredAt: iso(m.occurred_at),
      recordedAt: iso(m.recorded_at),
      recordedBy: m.recorded_by as string | null,
      requestId: m.request_id as string | null,
      dispatchStatus: m.dispatch_status as string | null,
      deliveryStatus: m.delivery_status as string | null,
      failureCode: m.failure_code as string | null
    })),
    nextBeforeSequence: messages.length > 50 ? Number(messages[49]!.sequence) : null
  };
}

export async function communicationConfiguration(
  client: SqlQueryClient,
  scope: RepositoryScope,
  now: Date,
  cursor?: string
): Promise<CommunicationConfiguration> {
  const accounts = (
    await client.query<Row>(
      `select a.id,a.account_type as name,r.activation_state as activation
    from external_accounts a join provider_callback_registrations r on r.tenant_id=a.tenant_id and r.clinic_id=a.clinic_id and r.external_account_id=a.id
    where a.tenant_id=$1 and a.clinic_id=$2 and r.provider_key='meta_whatsapp_cloud' order by a.id limit 100`,
      scopeArgs(scope)
    )
  ).rows;
  if (
    cursor &&
    !(
      await client.query(
        `select id from meta_whatsapp_template_snapshots where tenant_id=$1 and clinic_id=$2 and id=$3`,
        [...scopeArgs(scope), cursor]
      )
    ).rows.length
  )
    throw new CommunicationNotFound("Template cursor not found.");
  const templates = (
    await client.query<Row>(
      `select t.*,d.sync_status,d.snapshot_version,d.body,d.verified_at
    from meta_whatsapp_template_snapshots t left join communication_template_definitions d
      on d.tenant_id=t.tenant_id and d.clinic_id=t.clinic_id and d.template_id=t.id
    where t.tenant_id=$1 and t.clinic_id=$2 and ($3::uuid is null or t.id>$3) order by t.id limit 51`,
      [...scopeArgs(scope), cursor ?? null]
    )
  ).rows;
  const staff = (
    await client.query<Row>(
      `select distinct u.id,u.display_name as name from users u
    join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active'
    join clinic_user_assignments a on a.tenant_id=m.tenant_id and a.user_id=u.id and a.clinic_id=$2 and a.status='active'
    where u.status='active' and exists(select 1 from user_role_assignments x join role_permissions rp on rp.role_id=x.role_id where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=u.id and x.revoked_at is null and rp.permission_key='message.write') order by u.id limit 500`,
      scopeArgs(scope)
    )
  ).rows;
  return {
    accounts: accounts.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      activation: String(r.activation)
    })),
    templates: templates.slice(0, 50).map((t) => ({
      id: String(t.id),
      accountId: String(t.external_account_id),
      name: String(t.template_name),
      language: String(t.language_code),
      lifecycle: String(t.lifecycle_state),
      syncStatus: !t.sync_status
        ? "not_synced"
        : t.sync_status === "ready" &&
            (Number(t.snapshot_version) !== Number(t.row_version) ||
              t.lifecycle_state !== "approved" ||
              now.getTime() - new Date(iso(t.verified_at)).getTime() > 86_400_000)
          ? "stale"
          : (t.sync_status as "queued" | "ready" | "unsupported" | "failed"),
      body: (t.body as string | null) ?? null,
      verifiedAt: t.verified_at ? iso(t.verified_at) : null
    })),
    staff: staff.map((r) => ({ id: String(r.id), name: String(r.name) })),
    nextTemplateCursor: templates.length > 50 ? String(templates[49]!.id) : null
  };
}

export async function prepareCommunicationAppointment(
  client: SqlQueryClient,
  scope: RepositoryScope,
  input: { threadId: string; appointmentId: string; templateId: string },
  now: Date
) {
  const endpoint = (
    await client.query<Row>(
      `select external_account_id,contact from communication_threads where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [...scopeArgs(scope), input.threadId]
    )
  ).rows[0];
  if (!endpoint) throw new CommunicationNotFound("Conversation not found.");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `communication-contact:${scope.tenantId}:${scope.clinicId}:${endpoint.external_account_id}:${endpoint.contact}`
  ]);
  // Lock current evidence while taking the review snapshot. No recipient or text is accepted from the browser.
  const thread = (
    await client.query<Row>(
      `select * from communication_threads where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
      [...scopeArgs(scope), input.threadId]
    )
  ).rows[0];
  if (!thread) throw new CommunicationNotFound("Conversation not found.");
  if (!thread.patient_id)
    fail("Select and verify a patient before preparing an appointment message.");
  const appointment = (
    await client.query<Row>(
      `select a.*,p.phone,p.row_version as patient_version,u.display_name as doctor_name,c.display_name as clinic_name,c.timezone
    from appointments a join patients p on p.tenant_id=a.tenant_id and p.clinic_id=a.clinic_id and p.id=a.patient_id
    join users u on u.id=a.provider_user_id join clinics c on c.tenant_id=a.tenant_id and c.id=a.clinic_id
    where a.tenant_id=$1 and a.clinic_id=$2 and a.id=$3 and a.patient_id=$4 for share of a,p,c,u`,
      [...scopeArgs(scope), input.appointmentId, thread.patient_id]
    )
  ).rows[0];
  if (!appointment)
    throw new CommunicationNotFound("Appointment not found for the selected patient.");
  if (
    !["requested", "booked", "confirmed"].includes(String(appointment.status)) ||
    new Date(iso(appointment.start_at)).getTime() <= now.getTime()
  )
    fail("Only a current upcoming appointment can be messaged.");
  if (communicationPhone(String(appointment.phone)) !== thread.contact)
    fail("The patient's current phone does not match this conversation. Review the recipient.");
  const consent = (
    await client.query<Row>(
      `select id,template_version from consents where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and purpose='whatsapp_communication' and status='active' order by created_at desc,id desc limit 1 for share`,
      [...scopeArgs(scope), thread.patient_id]
    )
  ).rows[0];
  if (!consent) fail("Recorded active WhatsApp consent is required.");
  const optedOut = await client.query(
    `select c.id from meta_whatsapp_consent_commands c join meta_whatsapp_event_receipts e on e.tenant_id=c.tenant_id and e.clinic_id=c.clinic_id and e.id=c.event_receipt_id join normalized_integration_events n on n.tenant_id=e.tenant_id and n.clinic_id=e.clinic_id and n.id=e.normalized_event_id where c.tenant_id=$1 and c.clinic_id=$2 and e.external_account_id=$3 and c.command='opt_out' and n.normalized_payload->>'senderWaId'=$4 limit 1`,
    [...scopeArgs(scope), thread.external_account_id, String(thread.contact).slice(1)]
  );
  if (optedOut.rows.length)
    fail(
      "This contact has recorded a WhatsApp opt-out. Automated appointment messaging remains blocked; use an authorized manual contact workflow."
    );
  const template = (
    await client.query<Row>(
      `select t.*,d.body,d.definition_digest,d.verified_at,d.snapshot_version,d.sync_status
    from meta_whatsapp_template_snapshots t join communication_template_definitions d on d.tenant_id=t.tenant_id and d.clinic_id=t.clinic_id and d.template_id=t.id
    where t.tenant_id=$1 and t.clinic_id=$2 and t.id=$3 and t.external_account_id=$4 for share of t,d`,
      [...scopeArgs(scope), input.templateId, thread.external_account_id]
    )
  ).rows[0];
  if (
    !template ||
    template.lifecycle_state !== "approved" ||
    template.sync_status !== "ready" ||
    Number(template.row_version) !== Number(template.snapshot_version) ||
    now.getTime() - new Date(iso(template.verified_at)).getTime() > 86_400_000
  )
    fail("Sync and verify a supported approved template before preparing the message.");
  const registration = (
    await client.query<Row>(
      `select * from provider_callback_registrations where tenant_id=$1 and clinic_id=$2 and external_account_id=$3 and provider_key='meta_whatsapp_cloud' and activation_state in ('sandbox_verified','production_verified') for share`,
      [...scopeArgs(scope), thread.external_account_id]
    )
  ).rows;
  if (registration.length !== 1) fail("The official WhatsApp account is not activated.");
  const parameter = appointmentMessageParameter({
    clinic: String(appointment.clinic_name),
    doctor: String(appointment.doctor_name),
    startsAt: iso(appointment.start_at),
    timezone: String(appointment.timezone)
  });
  const text = String(template.body).replaceAll("{{1}}", parameter);
  const snapshot = {
    threadId: input.threadId,
    appointmentId: input.appointmentId,
    templateId: input.templateId,
    patientId: String(thread.patient_id),
    recipient: String(thread.contact),
    text,
    parameter,
    templateName: String(template.template_name),
    language: String(template.language_code),
    accountId: String(thread.external_account_id),
    appointmentVersion: Number(appointment.row_version),
    patientVersion: Number(appointment.patient_version),
    consentId: String(consent.id),
    consentVersion: Number(consent.template_version),
    templateVersion: Number(template.row_version),
    templateDefinitionDigest: String(template.definition_digest),
    providerTemplateId: String(template.provider_template_id),
    registrationId: String(registration[0]!.id),
    phoneNumberId: String(registration[0]!.provider_endpoint_id),
    apiVersion: String(registration[0]!.api_version)
  };
  return { snapshot, digest: hash(snapshot), registration: registration[0]! };
}
export async function previewCommunicationAppointment(
  client: SqlQueryClient,
  scope: RepositoryScope,
  input: { threadId: string; appointmentId: string; templateId: string },
  now: Date
): Promise<AppointmentMessagePreview> {
  const { snapshot, digest } = await prepareCommunicationAppointment(client, scope, input, now);
  return {
    threadId: input.threadId,
    appointmentId: input.appointmentId,
    templateId: input.templateId,
    patientId: snapshot.patientId,
    recipient: snapshot.recipient,
    text: snapshot.text,
    parameter: snapshot.parameter,
    templateName: snapshot.templateName,
    language: snapshot.language,
    digest
  };
}
export async function communicationOutbox(
  client: SqlQueryClient,
  scope: RepositoryScope,
  eventType: string,
  id: string,
  payload: Row,
  now: Date
) {
  const eventId = randomUUID();
  await client.query(
    `insert into outbox_events(id,tenant_id,clinic_id,event_type,schema_version,actor_type,actor_id,aggregate_type,aggregate_id,idempotency_key,correlation_id,payload,occurred_at)
    values($1::uuid,$2,$3,$4,'1.0','user',$5,'communication',$6,$7,$1::uuid::text,$8::jsonb,$9)`,
    [
      eventId,
      ...scopeArgs(scope),
      eventType,
      scope.actorUserId,
      id,
      `communication:${eventId}`,
      JSON.stringify(payload),
      now.toISOString()
    ]
  );
  return eventId;
}
export async function executeCommunicationCommand(
  client: SqlQueryClient,
  scope: RepositoryScope,
  input: CommunicationCommand,
  now: Date
): Promise<{ id: string; threadId: string | null; kind: CommunicationCommand["kind"] }> {
  await lockClinicConfiguration(client, scope);
  const args = scopeArgs(scope);
  if (input.kind === "start") {
    const p = (
      await client.query<Row>(
        `select id,phone from patients where tenant_id=$1 and clinic_id=$2 and id=$3 for share`,
        [...args, input.patientId]
      )
    ).rows[0];
    if (!p) throw new CommunicationNotFound("Patient not found.");
    const contact = communicationPhone(String(p.phone));
    if (!contact) fail("A verified international patient phone is required.");
    if (
      !(
        await client.query(
          `select id from provider_callback_registrations where tenant_id=$1 and clinic_id=$2 and external_account_id=$3 and provider_key='meta_whatsapp_cloud'`,
          [...args, input.accountId]
        )
      ).rows.length
    )
      throw new CommunicationNotFound("WhatsApp account not found.");
    await client.query(
      `insert into communication_threads(tenant_id,clinic_id,external_account_id,contact) values($1,$2,$3,$4) on conflict(tenant_id,clinic_id,external_account_id,contact) do nothing`,
      [...args, input.accountId, contact]
    );
    const t = (
      await client.query<Row>(
        `select id from communication_threads where tenant_id=$1 and clinic_id=$2 and external_account_id=$3 and contact=$4`,
        [...args, input.accountId, contact]
      )
    ).rows[0]!;
    // Even an existing shared-family conversation requires an explicit link decision.
    return { id: String(t.id), threadId: String(t.id), kind: input.kind };
  }
  if (input.kind === "sync_template") {
    if (
      !(
        await client.query(
          `select id from meta_whatsapp_template_snapshots where tenant_id=$1 and clinic_id=$2 and id=$3`,
          [...args, input.templateId]
        )
      ).rows.length
    )
      throw new CommunicationNotFound("Template not found.");
    const id = randomUUID();
    await client.query(
      `insert into communication_template_definitions(tenant_id,clinic_id,template_id,sync_job_id,sync_status) values($1,$2,$3,$4,'queued')
      on conflict(tenant_id,clinic_id,template_id) do update set sync_job_id=excluded.sync_job_id,sync_status='queued'`,
      [...args, input.templateId, id]
    );
    await communicationOutbox(
      client,
      scope,
      "communication.template_sync_requested",
      id,
      { templateId: input.templateId, jobId: id },
      now
    );
    return { id, threadId: null, kind: input.kind };
  }
  if (input.kind === "cancel_request") {
    const result = (
      await client.query<Row>(
        `update communication_requests set status='cancelled',failure_code='cancelled_by_staff' where tenant_id=$1 and clinic_id=$2 and id=$3 and status='queued' returning id,thread_id`,
        [...args, input.requestId]
      )
    ).rows[0];
    if (!result) fail("Only a queued request can be cancelled. Refresh its outcome.");
    return { id: String(result.id), threadId: String(result.thread_id), kind: input.kind };
  }
  if (input.kind === "approve") {
    const { snapshot, digest } = await prepareCommunicationAppointment(client, scope, input, now);
    if (digest !== input.expectedDigest)
      fail("The reviewed message has changed. Prepare and review it again.");
    const active = (
      await client.query(
        `select id from communication_requests where tenant_id=$1 and clinic_id=$2 and thread_id=$3 and appointment_id=$4 and (status in ('queued','sending','ambiguous','not_dispatched') or (status='accepted' and approval_digest=$5))`,
        [...args, input.threadId, input.appointmentId, digest]
      )
    ).rows;
    if (active.length)
      fail(
        "This appointment already has the same approved message or an unresolved send. Review its outcome before another send."
      );
    const id = randomUUID();
    const eventId = await communicationOutbox(
      client,
      scope,
      "communication.appointment_send_requested",
      id,
      { requestId: id },
      now
    );
    await client.query(
      `insert into communication_requests(id,tenant_id,clinic_id,thread_id,patient_id,appointment_id,template_id,approved_snapshot,approval_digest,approved_by_user_id,approved_at,expires_at,outbox_event_id)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
      [
        id,
        ...args,
        input.threadId,
        snapshot.patientId,
        input.appointmentId,
        input.templateId,
        JSON.stringify(snapshot),
        digest,
        scope.actorUserId,
        now.toISOString(),
        new Date(now.getTime() + 900_000).toISOString(),
        eventId
      ]
    );
    const t = (
      await client.query<Row>(
        `update communication_threads set latest_sequence=latest_sequence+1,row_version=row_version+1,updated_at=$4 where tenant_id=$1 and clinic_id=$2 and id=$3 returning latest_sequence`,
        [...args, input.threadId, now.toISOString()]
      )
    ).rows[0]!;
    await client.query(
      `insert into communication_messages(tenant_id,clinic_id,thread_id,sequence,kind,request_id,recorded_by_user_id,occurred_at,recorded_at) values($1,$2,$3,$4,'appointment_request',$5,$6,$7,$7)`,
      [...args, input.threadId, t.latest_sequence, id, scope.actorUserId, now.toISOString()]
    );
    return { id, threadId: input.threadId, kind: input.kind };
  }
  const t = (
    await client.query<Row>(
      `select * from communication_threads where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
      [...args, input.threadId]
    )
  ).rows[0];
  if (!t) throw new CommunicationNotFound("Conversation not found.");
  if (input.kind === "read") {
    if (
      !Number.isSafeInteger(input.throughSequence) ||
      input.throughSequence < 0 ||
      input.throughSequence > Number(t.latest_sequence)
    )
      throw new RangeError("Invalid read position.");
    await client.query(
      `insert into communication_reads(tenant_id,clinic_id,thread_id,user_id,through_sequence) values($1,$2,$3,$4,$5)
      on conflict(tenant_id,clinic_id,thread_id,user_id) do update set through_sequence=greatest(communication_reads.through_sequence,excluded.through_sequence)`,
      [...args, input.threadId, scope.actorUserId, input.throughSequence]
    );
    return { id: input.threadId, threadId: input.threadId, kind: input.kind };
  }
  if (Number(t.row_version) !== input.expectedVersion)
    fail("This conversation changed. Refresh before editing it.");
  if (input.kind === "update") {
    if (
      input.assignedUserId &&
      !(
        await client.query(
          `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active'
      join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=m.tenant_id and a.clinic_id=$2 and a.status='active'
      where u.id=$3 and u.status='active' and exists(select 1 from user_role_assignments x join role_permissions rp on rp.role_id=x.role_id where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=u.id and x.revoked_at is null and rp.permission_key='message.write')`,
          [...args, input.assignedUserId]
        )
      ).rows.length
    )
      fail("Assignee is not an active clinic staff member.");
    await client.query(
      `update communication_threads set status=$4,assigned_user_id=$5,row_version=row_version+1,updated_at=$6 where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [...args, input.threadId, input.status, input.assignedUserId, now.toISOString()]
    );
  } else if (input.kind === "link") {
    if (!input.reason.trim() || input.reason.length > 1900)
      throw new RangeError("Record the reason for this explicit identity decision.");
    if (
      input.patientId &&
      !(
        await client.query(
          `select id from patients where tenant_id=$1 and clinic_id=$2 and id=$3`,
          [...args, input.patientId]
        )
      ).rows.length
    )
      throw new CommunicationNotFound("Patient not found.");
    if (
      input.leadId &&
      !(
        await client.query(
          `select id from leads where tenant_id=$1 and clinic_id=$2 and id=$3 and (patient_id is null or patient_id=$4)`,
          [...args, input.leadId, input.patientId]
        )
      ).rows.length
    )
      fail("Enquiry is not available for this patient.");
    if (
      (
        await client.query(
          `select id from communication_requests where tenant_id=$1 and clinic_id=$2 and thread_id=$3 and status in ('queued','sending','not_dispatched','ambiguous')`,
          [...args, input.threadId]
        )
      ).rows.length
    )
      fail("Resolve pending messages before changing the selected patient.");
    await client.query(
      `update communication_threads set patient_id=$4,lead_id=$5,row_version=row_version+1,updated_at=$6 where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [...args, input.threadId, input.patientId, input.leadId, now.toISOString()]
    );
    await addManualMessage(
      client,
      scope,
      input.threadId,
      `Identity review: ${input.reason.trim()}`,
      now
    );
  } else {
    if (!input.evidence.trim() || input.evidence.length > 2000)
      throw new RangeError("Record bounded manual contact evidence.");
    await addManualMessage(client, scope, input.threadId, input.evidence.trim(), now);
  }
  return { id: input.threadId, threadId: input.threadId, kind: input.kind };
}
async function addManualMessage(
  client: SqlQueryClient,
  scope: RepositoryScope,
  id: string,
  evidence: string,
  now: Date
) {
  const t = (
    await client.query<Row>(
      `update communication_threads set latest_sequence=latest_sequence+1,row_version=row_version+1,updated_at=$4 where tenant_id=$1 and clinic_id=$2 and id=$3 returning latest_sequence`,
      [...scopeArgs(scope), id, now.toISOString()]
    )
  ).rows[0]!;
  await client.query(
    `insert into communication_messages(tenant_id,clinic_id,thread_id,sequence,kind,manual_evidence,recorded_by_user_id,occurred_at,recorded_at) values($1,$2,$3,$4,'manual_contact',$5,$6,$7,$7)`,
    [...scopeArgs(scope), id, t.latest_sequence, evidence, scope.actorUserId, now.toISOString()]
  );
}

export async function listCommunicationAppointments(
  client: SqlQueryClient,
  scope: RepositoryScope,
  threadId: string,
  now: Date,
  cursor?: string
) {
  const t = (
    await client.query<Row>(
      `select patient_id from communication_threads where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [...scopeArgs(scope), threadId]
    )
  ).rows[0];
  if (!t) throw new CommunicationNotFound("Conversation not found.");
  if (!t.patient_id) return { appointments: [], nextCursor: null };
  let anchor: Row | undefined;
  if (cursor) {
    anchor = (
      await client.query<Row>(
        `select id,start_at from appointments where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4`,
        [...scopeArgs(scope), t.patient_id, cursor]
      )
    ).rows[0];
    if (!anchor) throw new CommunicationNotFound("Appointment cursor not found.");
  }
  const rows = (
    await client.query<Row>(
      `select a.id,a.start_at,a.status,u.display_name as doctor_name,c.timezone from appointments a join users u on u.id=a.provider_user_id join clinics c on c.tenant_id=a.tenant_id and c.id=a.clinic_id where a.tenant_id=$1 and a.clinic_id=$2 and a.patient_id=$3 and a.start_at>$4 and a.status in ('requested','booked','confirmed') and ($5::timestamptz is null or (a.start_at,a.id)>($5::timestamptz,$6::uuid)) order by a.start_at,a.id limit 51`,
      [
        ...scopeArgs(scope),
        t.patient_id,
        now.toISOString(),
        anchor?.start_at ?? null,
        anchor?.id ?? null
      ]
    )
  ).rows;
  return {
    appointments: rows.slice(0, 50).map((r) => ({
      id: String(r.id),
      startAt: iso(r.start_at),
      status: String(r.status),
      doctorName: String(r.doctor_name),
      timezone: String(r.timezone)
    })),
    nextCursor: rows.length > 50 ? String(rows[49]!.id) : null
  };
}

/** Serialize provider state transitions with dispatch finalization. Signed callback
 * batches can mix STOP and status events; this common order prevents a contact /
 * outbound-row lock inversion while the bounded provider call is in flight. */
export async function lockMetaWhatsAppDispatch(
  client: SqlQueryClient,
  scope: Pick<RepositoryScope, "tenantId" | "clinicId">
) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `meta-whatsapp-dispatch:${scope.tenantId}:${scope.clinicId}`
  ]);
}

/** Revalidate queued authors against the API's current tenant/clinic authority.
 * Row locks keep deactivation/revocation from committing between this check and
 * the bounded dispatch. Tenant-wide roles do not require a clinic assignment. */
export async function hasCurrentCommunicationAuthority(
  client: SqlQueryClient,
  scope: RepositoryScope,
  requiredPermissions: readonly string[]
): Promise<boolean> {
  const args = [scope.tenantId, scope.clinicId, scope.actorUserId];
  if (!requiredPermissions.length) return false;
  const clinic = await client.query(
    "select id from clinics where tenant_id=$1 and id=$2 and status='active' for share",
    args.slice(0, 2)
  );
  if (!clinic.rows.length) return false;
  const tenant = await client.query(
    "select id from tenants where id=$1 and status='active' for share",
    [scope.tenantId]
  );
  if (!tenant.rows.length) return false;
  const user = await client.query(
    "select id from users where id=$1 and status='active' for share",
    [scope.actorUserId]
  );
  if (!user.rows.length) return false;
  // Membership, assignment and role changes invalidate the locked user/tenant
  // through 0025 triggers. Read their committed state AFTER those locks without
  // locking child rows in reverse trigger order (which would deadlock revocation).
  const membership = await client.query(
    "select id from memberships where tenant_id=$1 and user_id=$2 and status='active'",
    [scope.tenantId, scope.actorUserId]
  );
  if (!membership.rows.length) return false;
  const assignments = await client.query(
    "select id from clinic_user_assignments where tenant_id=$1 and clinic_id=$2 and user_id=$3 and status='active'",
    args
  );
  const grants = await client.query<{ clinic_id: string | null; permission_key: string }>(
    `select x.clinic_id,rp.permission_key from user_role_assignments x join role_permissions rp on rp.role_id=x.role_id
     where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=$3 and x.revoked_at is null`,
    args
  );
  const eligibleGrants = assignments.rows.length
    ? grants.rows
    : grants.rows.filter((r) => r.clinic_id === null);
  return requiredPermissions.every((permission) =>
    eligibleGrants.some((r) => r.permission_key === permission)
  );
}
