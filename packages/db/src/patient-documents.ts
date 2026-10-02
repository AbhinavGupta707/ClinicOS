import { createHash, randomUUID } from "node:crypto";
import {
  documentMoney,
  renderPatientDocumentV1,
  validateDocumentSnapshot,
  type DocumentSection,
  type PatientDocumentKind,
  type PatientDocumentRecord,
  type PatientDocumentSnapshot
} from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
import { sqlCalendarDate } from "./sql-calendar-date.ts";

type Row = Record<string, unknown>;
export class PatientDocumentConflict extends Error {}
export class PatientDocumentUnavailable extends Error {}
class PatientDocumentSourceUnsupported extends Error {}
const tables = {
  prescription: "prescriptions",
  estimate: "treatment_plans",
  invoice: "invoices",
  receipt: "receipts",
  instruction: "patient_instruction_requests",
  lab_slip: "lab_cases"
} as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const text = (value: unknown) => (value == null ? "" : String(value));
function integer(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new PatientDocumentSourceUnsupported(
      "Source amounts or quantities cannot be represented safely."
    );
  return n;
}
const money = (value: unknown) => documentMoney(integer(value));
const section = (
  title: string,
  paragraphs: string[] = [],
  columns: string[] = [],
  rows: string[][] = []
): DocumentSection => ({ title, paragraphs, columns, rows });
function dateLabel(value: unknown, zone: string) {
  return value == null
    ? "Not recorded"
    : `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso(value)))} (${zone})`;
}
function sum(rows: Row[], column: string): number {
  const n = rows.reduce((total, row) => total + integer(row[column]), 0);
  if (!Number.isSafeInteger(n))
    throw new PatientDocumentSourceUnsupported("Source total exceeds the supported amount.");
  return n;
}
function verifyLines(source: Row, rows: Row[]) {
  if (!rows.length || rows.length > 2500)
    throw new PatientDocumentSourceUnsupported(
      "Document requires between 1 and 2,500 saved line items."
    );
  let subtotal = 0;
  for (const r of rows) {
    const base = integer(r.quantity) * integer(r.unit_price_minor);
    if (
      !Number.isSafeInteger(base) ||
      base - integer(r.discount_minor) + integer(r.tax_minor) !== integer(r.total_minor)
    )
      throw new PatientDocumentSourceUnsupported("Saved line totals do not reconcile.");
    subtotal += base;
  }
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal !== integer(source.subtotal_minor) ||
    ["discount_minor", "tax_minor", "total_minor"].some((k) => sum(rows, k) !== integer(source[k]))
  )
    throw new PatientDocumentSourceUnsupported(
      "Saved document totals do not reconcile. Review the source record."
    );
}
function totals(source: Row) {
  return section("Recorded totals", [
    `Subtotal: ${money(source.subtotal_minor)}`,
    `Discount: ${money(source.discount_minor)}`,
    `Tax: ${money(source.tax_minor)}`,
    `Total: ${money(source.total_minor)}`
  ]);
}
export function patientDocumentEligibility(kind: PatientDocumentKind, row: Row): string | null {
  if (
    kind === "prescription" &&
    (row.status !== "signed" || !row.signed_at || !row.signed_by_user_id)
  )
    return "Only a saved, signed prescription can generate a copy.";
  if (kind === "invoice" && row.status !== "issued")
    return "This invoice is no longer issued. Existing copies are historical.";
  if (kind === "receipt" && row.status !== "generated")
    return "This receipt is void. Existing copies are historical.";
  if (kind === "instruction" && (row.channel !== "print" || row.status !== "ready_for_print"))
    return "Only saved print instructions can generate a copy.";
  if ((kind === "estimate" || kind === "lab_slip") && row.status === "cancelled")
    return "This source is cancelled. Existing copies are historical.";
  return null;
}
/** All names originate in a closed table map; all values remain SQL parameters. */
async function composePatientDocument(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: string,
  kind: PatientDocumentKind,
  sourceId: string
) {
  const table = tables[kind];
  if (!table) throw new RangeError("Unknown document kind.");
  const args = [scope.tenantId, scope.clinicId, patientId, sourceId];
  const patient = (
    await client.query<Row>(
      "select * from patients where tenant_id=$1 and clinic_id=$2 and id=$3 for share",
      args.slice(0, 3)
    )
  ).rows[0];
  if (!patient) return null;
  const clinic = (
    await client.query<Row>(
      "select * from clinics where tenant_id=$1 and id=$2 for share",
      args.slice(0, 2)
    )
  ).rows[0];
  if (!clinic) return null;
  const source = (
    await client.query<Row>(
      `select * from ${table} where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4 for share`,
      args
    )
  ).rows[0];
  if (!source) return null;
  const unavailableReason = patientDocumentEligibility(kind, source);
  if (unavailableReason)
    return {
      snapshot: null,
      sourceDigest: null,
      unavailableReason,
      sourceStatus: text(source.status)
    };
  const zone = text(clinic.timezone);
  const snapshot: PatientDocumentSnapshot = {
    kind,
    patientId,
    sourceId,
    sourceVersion: iso(
      source.row_version ?? source.updated_at ?? source.generated_at ?? source.created_at
    ),
    sourceStatus: text(source.status),
    title: "",
    clinicName: text(clinic.display_name),
    patientName: text(patient.full_name),
    facts: [],
    sections: [],
    notices: []
  };
  if (clinic.legal_name) snapshot.facts.push(["Clinic legal name", text(clinic.legal_name)]);
  if (clinic.address && typeof clinic.address === "object" && !Array.isArray(clinic.address)) {
    const address = Object.entries(clinic.address as Row)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}: ${text(value)}`)
      .join("\n");
    if (address) snapshot.facts.push(["Clinic address", address]);
  }
  snapshot.facts.push(["Clinic timezone", zone]);
  if (["prescription", "lab_slip"].includes(kind) && patient.date_of_birth)
    snapshot.facts.push([
      "Date of birth",
      sqlCalendarDate(patient.date_of_birth as string | Date)!
    ]);
  const staff = async (id: unknown) => {
    const row = (
      await client.query<Row>(
        "select id,display_name,updated_at from users where id=$1 for share",
        [id]
      )
    ).rows[0];
    if (!row)
      throw new PatientDocumentSourceUnsupported("The recorded author identity is unavailable.");
    return row;
  };
  const moneyColumns = ["Description / status", "Qty", "Unit price", "Discount", "Tax", "Total"];
  if (kind === "prescription") {
    const author = await staff(source.signed_by_user_id);
    snapshot.title = "Signed prescription";
    snapshot.facts.push(
      ["Signing clinician", text(author.display_name)],
      ["Signing staff record", text(author.id)],
      ["Signed", dateLabel(source.signed_at, zone)]
    );
    const meds = source.medications as Row[];
    if (!Array.isArray(meds) || meds.length < 1 || meds.length > 100)
      throw new PatientDocumentSourceUnsupported("Prescription medication count is unsupported.");
    snapshot.sections = meds.map((m, index) =>
      section(`${index + 1}. ${text(m.name)} ${text(m.strength)}`, [
        `Route: ${text(m.route) || "Not recorded"}`,
        `Frequency: ${text(m.frequency)}`,
        `Duration: ${text(m.duration)}`,
        ...(m.instructions ? [text(m.instructions)] : [])
      ])
    );
    if (source.notes) snapshot.sections.push(section("Prescriber notes", [text(source.notes)]));
    snapshot.notices.push(
      "Signing identity and time are copied from the saved clinical record. Clinician registration details and signature artwork are not recorded in this output; clinic-approved prescription requirements must be checked before dispensing use."
    );
  } else if (kind === "estimate") {
    const rows = (
      await client.query<Row>(
        `select e.*,p.display_name as procedure_name,ph.title as phase_title,ph.phase_index from treatment_plan_estimate_items e join treatment_plan_phases ph on (ph.tenant_id,ph.clinic_id,ph.treatment_plan_id,ph.id)=(e.tenant_id,e.clinic_id,e.treatment_plan_id,e.phase_id) join pricebook_procedures p on (p.tenant_id,p.clinic_id,p.id)=(e.tenant_id,e.clinic_id,e.pricebook_procedure_id) where e.tenant_id=$1 and e.clinic_id=$2 and e.treatment_plan_id=$3 order by ph.phase_index,e.created_at,e.id limit 2501 for share of e,ph,p`,
        [...args.slice(0, 2), sourceId]
      )
    ).rows;
    verifyLines(source, rows);
    snapshot.title = `Treatment estimate - ${text(source.status).replaceAll("_", " ")}`;
    snapshot.facts.push(
      ["Plan", text(source.title)],
      ["Plan recorded", dateLabel(source.created_at, zone)]
    );
    snapshot.sections.push(
      section(
        "Planned treatment",
        [],
        moneyColumns,
        rows.map((r) => [
          `${text(r.phase_title)} / ${text(r.procedure_name)}${r.tooth_number ? ` / tooth ${text(r.tooth_number)}` : ""} / ${text(r.status)}${r.notes ? `\n${text(r.notes)}` : ""}`,
          String(integer(r.quantity)),
          money(r.unit_price_minor),
          money(r.discount_minor),
          money(r.tax_minor),
          money(r.total_minor)
        ])
      ),
      totals(source)
    );
    snapshot.notices.push(
      "An estimate is not an invoice, payment request or proof of acceptance. All saved line items and their statuses are shown; amounts follow the saved plan totals."
    );
  } else if (kind === "invoice") {
    const rows = (
      await client.query<Row>(
        "select * from invoice_items where tenant_id=$1 and clinic_id=$2 and invoice_id=$3 order by created_at,id limit 2501 for share",
        [...args.slice(0, 2), sourceId]
      )
    ).rows;
    verifyLines(source, rows);
    snapshot.sourceVersion = `financial ${text(source.financial_version)} / ${iso(source.updated_at)}`;
    snapshot.title = `Invoice ${text(source.invoice_number)}`;
    snapshot.facts.push(
      ["Issued", dateLabel(source.issued_at, zone)],
      ["Due", dateLabel(source.due_at, zone)]
    );
    snapshot.sections.push(
      section(
        "Saved invoice items",
        [],
        moneyColumns,
        rows.map((r) => [
          text(r.description),
          String(integer(r.quantity)),
          money(r.unit_price_minor),
          money(r.discount_minor),
          money(r.tax_minor),
          money(r.total_minor)
        ])
      ),
      totals(source),
      section("Account position at generation", [
        `Credited: ${money(source.credited_minor ?? 0)}`,
        `Paid: ${money(source.paid_minor)}`,
        `Returned: ${money(source.refunded_minor)}`,
        `Balance: ${money(source.balance_minor)}`,
        `Payment status: ${text(source.payment_status).replaceAll("_", " ")}`
      ])
    );
    snapshot.notices.push(
      "This is the saved invoice and its account position at generation, not a live balance or a receipt. Subsequent financial entries remain separate."
    );
  } else if (kind === "receipt") {
    const invoice = (
      await client.query<Row>(
        "select invoice_number,status,financial_version from invoices where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4 for share",
        [...args.slice(0, 3), source.invoice_id]
      )
    ).rows[0];
    if (!invoice)
      throw new PatientDocumentSourceUnsupported("Receipt invoice identity is unavailable.");
    const allocations = source.payment_allocations as Row[];
    if (
      !Array.isArray(allocations) ||
      !allocations.length ||
      allocations.length > 2500 ||
      sum(allocations, "amountMinor") !== integer(source.amount_minor)
    )
      throw new PatientDocumentSourceUnsupported("Receipt allocations do not reconcile.");
    snapshot.title = `Receipt ${text(source.receipt_number)}`;
    snapshot.sourceVersion = `${iso(source.generated_at)} / invoice financial ${text(invoice.financial_version)}`;
    snapshot.facts.push(
      ["Invoice", text(invoice.invoice_number)],
      ["Receipt recorded", dateLabel(source.generated_at, zone)]
    );
    snapshot.sections.push(
      section(
        "Original receipt allocations",
        [],
        ["Payment record", "Amount received"],
        allocations.map((a) => [text(a.paymentTransactionId), money(a.amountMinor)])
      ),
      section("Original received amount", [money(source.amount_minor)])
    );
    snapshot.notices.push(
      "Records the original receipt allocations. Later corrections, reversals and refunds do not rewrite this receipt; consult the patient financial account. A manually recorded payment is not independent bank-settlement confirmation."
    );
  } else if (kind === "instruction") {
    const author = await staff(source.created_by_user_id);
    snapshot.title = text(source.title);
    snapshot.facts.push(
      ["Approved protocol/reference", text(source.template_id)],
      ["Recorded by", text(author.display_name)],
      ["Recorded", dateLabel(source.created_at, zone)]
    );
    snapshot.sections.push(section("Patient instructions", [text(source.body)]));
    snapshot.notices.push(
      "Saved instruction text is reproduced without additions. Generation does not confirm patient handover or understanding."
    );
  } else {
    const vendor = (
      await client.query<Row>(
        "select * from lab_vendors where tenant_id=$1 and clinic_id=$2 and id=$3 for share",
        [...args.slice(0, 2), source.vendor_id]
      )
    ).rows[0];
    if (!vendor) throw new PatientDocumentSourceUnsupported("Lab vendor identity is unavailable.");
    const rows = (
      await client.query<Row>(
        "select * from lab_case_items where tenant_id=$1 and clinic_id=$2 and lab_case_id=$3 order by created_at,id limit 101 for share",
        [...args.slice(0, 2), sourceId]
      )
    ).rows;
    if (!rows.length || rows.length > 100)
      throw new PatientDocumentSourceUnsupported(
        "Lab slip requires between 1 and 100 saved items."
      );
    snapshot.title = `${source.status === "draft" ? "Draft lab slip" : "Lab slip"} ${text(source.slip_number)}`;
    snapshot.facts.push(
      ["Case", text(source.title)],
      ["Lab", text(vendor.display_name)],
      ["Due", dateLabel(source.due_at, zone)],
      ["Priority", text(source.priority)],
      ["Saved slip version", text(source.slip_version)]
    );
    snapshot.sections.push(
      section(
        "Lab instructions",
        source.clinical_notes ? [text(source.clinical_notes)] : [],
        ["Item", "Tooth", "Material / shade", "Quantity", "Notes"],
        rows.map((r) => [
          text(r.item_type),
          text(r.tooth_number) || "Not recorded",
          [text(r.material), text(r.shade)].filter(Boolean).join(" / "),
          String(integer(r.quantity)),
          text(r.notes)
        ])
      )
    );
    snapshot.notices.push(
      "Internal clinic notes and agreed lab cost are excluded. Generation is not dispatch, vendor acceptance or completion evidence."
    );
  }
  try {
    validateDocumentSnapshot(snapshot);
  } catch (e) {
    throw new PatientDocumentSourceUnsupported(
      e instanceof Error ? e.message : "Document content is unsupported."
    );
  }
  // Include saved identity revisions even when their visible values return to an older value.
  const sourceDigest = hash(
    JSON.stringify({
      snapshot,
      patientVersion: patient.row_version,
      clinicVersion: clinic.row_version
    })
  );
  return { snapshot, sourceDigest, unavailableReason: null, sourceStatus: snapshot.sourceStatus };
}
/** Composition failures disable new output while retaining access to immutable history. */
export async function preparePatientDocument(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: string,
  kind: PatientDocumentKind,
  sourceId: string
) {
  try {
    return await composePatientDocument(client, scope, patientId, kind, sourceId);
  } catch (error) {
    if (!(error instanceof PatientDocumentSourceUnsupported)) throw error;
    return {
      snapshot: null,
      sourceDigest: null,
      unavailableReason: error.message,
      sourceStatus: "unavailable"
    };
  }
}
function map(row: Row): PatientDocumentRecord {
  return {
    id: text(row.id),
    revision: integer(row.revision),
    sourceDigest: text(row.source_digest),
    rendererVersion: integer(row.renderer_version) as 1,
    generatedAt: iso(row.generated_at),
    generatedBy: text(row.generated_by_display_name),
    previousDocumentId: row.previous_document_id ? text(row.previous_document_id) : null,
    snapshot: row.snapshot as PatientDocumentSnapshot,
    htmlDigest: text(row.html_digest)
  };
}
export function renderSavedPatientDocument(record: PatientDocumentRecord) {
  const html = renderPatientDocumentV1(record.snapshot, record);
  if (hash(html) !== record.htmlDigest)
    throw new PatientDocumentUnavailable(
      "Saved document integrity could not be verified. Do not use a rewritten copy."
    );
  return html;
}
export async function listPatientDocuments(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: string,
  kind: PatientDocumentKind,
  sourceId: string,
  cursor?: string
) {
  const args = [scope.tenantId, scope.clinicId, patientId, kind, sourceId];
  let before: number | null = null;
  if (cursor) {
    const found = (
      await client.query<Row>(
        "select revision from patient_documents where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and kind=$4 and source_id=$5 and id=$6",
        [...args, cursor]
      )
    ).rows[0];
    if (!found) throw new RangeError("Document cursor does not belong to this source.");
    before = integer(found.revision);
  }
  const rows = (
    await client.query<Row>(
      "select id,revision,generated_at,source_digest,html_digest from patient_documents where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and kind=$4 and source_id=$5 and ($6::int is null or revision<$6) order by revision desc limit 21",
      [...args, before]
    )
  ).rows;
  return {
    documents: rows.slice(0, 20).map((r) => ({
      id: text(r.id),
      revision: integer(r.revision),
      generatedAt: iso(r.generated_at),
      sourceDigest: text(r.source_digest),
      htmlDigest: text(r.html_digest)
    })),
    nextCursor: rows.length > 20 ? text(rows[19]!.id) : null
  };
}
export async function getPatientDocument(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: string,
  kind: PatientDocumentKind,
  sourceId: string,
  documentId: string
) {
  const row = (
    await client.query<Row>(
      "select * from patient_documents where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and kind=$4 and source_id=$5 and id=$6",
      [scope.tenantId, scope.clinicId, patientId, kind, sourceId, documentId]
    )
  ).rows[0];
  return row ? map(row) : null;
}
export async function issuePatientDocument(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: string,
  kind: PatientDocumentKind,
  sourceId: string,
  expectedSourceDigest: string,
  now: Date
) {
  if (!/^[0-9a-f]{64}$/.test(expectedSourceDigest))
    throw new RangeError("Review a current document preview first.");
  const args = [scope.tenantId, scope.clinicId, patientId, kind, sourceId];
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `patient-document:${args.join(":")}`
  ]);
  const prepared = await preparePatientDocument(client, scope, patientId, kind, sourceId);
  if (!prepared) return null;
  if (!prepared.snapshot || !prepared.sourceDigest)
    throw new PatientDocumentConflict(prepared.unavailableReason!);
  if (prepared.sourceDigest !== expectedSourceDigest)
    throw new PatientDocumentConflict(
      "Source or display details changed. Refresh and review the new preview before generating a copy."
    );
  const latest = (
    await client.query<Row>(
      "select * from patient_documents where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and kind=$4 and source_id=$5 order by revision desc limit 1",
      args
    )
  ).rows[0];
  if (latest?.source_digest === expectedSourceDigest) {
    const document = map(latest);
    renderSavedPatientDocument(document);
    return { document, created: false };
  }
  const actor = (
    await client.query<Row>("select display_name from users where id=$1 for share", [
      scope.actorUserId
    ])
  ).rows[0];
  if (!actor) throw new PatientDocumentUnavailable("Generating staff identity is unavailable.");
  const document: PatientDocumentRecord = {
    id: randomUUID(),
    revision: integer(latest?.revision ?? 0) + 1,
    sourceDigest: expectedSourceDigest,
    rendererVersion: 1,
    generatedAt: now.toISOString(),
    generatedBy: text(actor.display_name),
    previousDocumentId: latest ? text(latest.id) : null,
    snapshot: prepared.snapshot,
    htmlDigest: ""
  };
  document.htmlDigest = hash(renderPatientDocumentV1(document.snapshot, document));
  await client.query(
    `insert into patient_documents(id,tenant_id,clinic_id,patient_id,kind,source_id,source_digest,revision,renderer_version,snapshot,html_digest,generated_at,generated_by_user_id,generated_by_display_name,previous_document_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb,$10,$11,$12,$13,$14)`,
    [
      document.id,
      ...args,
      document.sourceDigest,
      document.revision,
      JSON.stringify(document.snapshot),
      document.htmlDigest,
      document.generatedAt,
      scope.actorUserId,
      document.generatedBy,
      document.previousDocumentId
    ]
  );
  return { document, created: true };
}
