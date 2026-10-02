/** Versioned, scriptless clinic output. Keep v1 byte-stable for saved reprints. */
export const PATIENT_DOCUMENT_KINDS = [
  "prescription",
  "estimate",
  "invoice",
  "receipt",
  "instruction",
  "lab_slip"
] as const;
export type PatientDocumentKind = (typeof PATIENT_DOCUMENT_KINDS)[number];
export interface DocumentSection {
  title: string;
  paragraphs: string[];
  columns: string[];
  rows: string[][];
}
export interface PatientDocumentSnapshot {
  kind: PatientDocumentKind;
  patientId: string;
  sourceId: string;
  sourceVersion: string;
  sourceStatus: string;
  title: string;
  clinicName: string;
  patientName: string;
  facts: [string, string][];
  sections: DocumentSection[];
  notices: string[];
}
export interface PatientDocumentRecord {
  id: string;
  revision: number;
  sourceDigest: string;
  rendererVersion: 1;
  generatedAt: string;
  generatedBy: string;
  previousDocumentId: string | null;
  snapshot: PatientDocumentSnapshot;
  htmlDigest: string;
}
export function documentMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Document amount is not a safe non-negative integer.");
  const whole = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `INR ${whole}.${String(value % 100).padStart(2, "0")}`;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
export function validateDocumentSnapshot(snapshot: PatientDocumentSnapshot): void {
  if (
    !PATIENT_DOCUMENT_KINDS.includes(snapshot.kind) ||
    snapshot.facts.length > 40 ||
    snapshot.sections.length > 128 ||
    snapshot.notices.length > 12
  )
    throw new RangeError("Document composition exceeds supported bounds.");
  for (const section of snapshot.sections) {
    if (
      section.rows.length > 2500 ||
      section.columns.length > 8 ||
      section.paragraphs.length > 256 ||
      section.rows.some((row) => row.length !== section.columns.length)
    )
      throw new RangeError("Document rows exceed supported bounds.");
  }
  const strings = [
    snapshot.title,
    snapshot.clinicName,
    snapshot.patientName,
    ...snapshot.facts.flat(),
    ...snapshot.notices,
    ...snapshot.sections.flatMap((s) => [s.title, ...s.paragraphs, ...s.columns, ...s.rows.flat()])
  ];
  const serialized = JSON.stringify(snapshot);
  if (
    new TextEncoder().encode(serialized).length > 524288 ||
    strings.some((s) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(s))
  )
    throw new RangeError(
      "Document content exceeds the supported size or encoding. Correct the source; nothing was truncated."
    );
}
export function renderPatientDocumentV1(
  snapshot: PatientDocumentSnapshot,
  issued?: Omit<PatientDocumentRecord, "snapshot" | "htmlDigest">
): string {
  validateDocumentSnapshot(snapshot);
  if (issued && issued.rendererVersion !== 1)
    throw new RangeError("Document renderer is unavailable.");
  const id = issued?.id ?? "PREVIEW";
  if (!/^(PREVIEW|[0-9a-f-]{36})$/i.test(id)) throw new RangeError("Invalid document identifier.");
  const facts: [string, string][] = [
    ["Patient", snapshot.patientName],
    ["Source status at generation", snapshot.sourceStatus.replaceAll("_", " ")],
    ...snapshot.facts
  ];
  const provenance = [
    `Patient record ${snapshot.patientId}`,
    `Source ${snapshot.sourceId} / version ${snapshot.sourceVersion}`,
    ...(issued
      ? [
          `Generated copy ${id} / revision ${issued.revision}`,
          `Generated ${issued.generatedAt} (UTC) by ${issued.generatedBy}`,
          ...(issued.previousDocumentId ? [`Previous copy ${issued.previousDocumentId}`] : [])
        ]
      : [])
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title)} - ${escape(id)}</title><style>
@page{size:A4;margin:20mm 15mm;@top-left{content:"ClinicOS / ${id}";font:8pt Arial,sans-serif;color:#475d59}@bottom-right{content:"Page " counter(page) " / " counter(pages);font:8pt Arial,sans-serif;color:#475d59}}
*{box-sizing:border-box}body{color:#142d2a;font:11pt/1.5 Arial,sans-serif;max-width:180mm;margin:auto;padding:5mm;background:#fff}h1{font-size:20pt;line-height:1.2;margin:0 0 8px}h2{break-after:avoid;font-size:15pt;margin:0 0 16px}h3{break-after:avoid;font-size:12pt}p,dd,dt,td,th{overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 20px;margin:0}.fact{break-inside:avoid;min-width:0}dt{font-size:9pt;color:#475d59}dd{margin:0}.provenance{font-size:8pt;line-height:1.4}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9pt}th,td{padding:6px;border-bottom:1px solid #bacbc8;text-align:left;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}section{margin-top:16px}p{orphans:3;widows:3;margin:8px 0}.notice{border-left:3px solid #637f77;padding:8px;font-size:10pt}.summary-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 16px}.summary-grid p{break-inside:avoid}.footer{break-inside:avoid;font-size:9pt;color:#475d59;border-top:1px solid #bacbc8;margin-top:20px;padding-top:10px}@media print{body{padding:0;max-width:none}}
</style></head><body><header><h1>${escape(snapshot.clinicName)}</h1><h2>${escape(snapshot.title)}</h2>${issued ? "" : '<p class="notice">PREVIEW ONLY - no generated copy has been recorded.</p>'}<dl>${facts.map(([key, value]) => `<div class="fact"><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl></header>${snapshot.sections.map((section) => `<section><h3>${escape(section.title)}</h3>${section.paragraphs.length ? `<div class="${snapshot.kind === "invoice" || snapshot.kind === "estimate" ? "summary-grid" : "paragraphs"}">${section.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("")}</div>` : ""}${section.columns.length ? `<table><thead><tr>${section.columns.map((c) => `<th scope="col">${escape(c)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}</section>`).join("")}${snapshot.notices.map((n) => `<p class="notice">${escape(n)}</p>`).join("")}<footer class="footer"><p class="provenance">${provenance.map(escape).join("<br>")}</p>${issued ? "Saved source snapshot. Later amendments, credits, refunds or cancellations may exist; verify the current record before use." : "Review the saved source before generating a copy."} This output does not add a digital signature or prove printing, delivery, payment settlement or patient acceptance. Template clinic-document-html-v1.</footer></body></html>`;
}
