import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  documentMoney,
  renderPatientDocumentV1,
  type PatientDocumentSnapshot
} from "../src/patient-documents.ts";
const source: PatientDocumentSnapshot = {
  kind: "instruction",
  patientId: "10000000-0000-4000-8000-000000000001",
  sourceId: "10000000-0000-4000-8000-000000000002",
  sourceVersion: "1",
  sourceStatus: "ready_for_print",
  title: "Synthetic instructions",
  clinicName: "Synthetic Clinic",
  patientName: "Synthetic नमस्ते",
  facts: [["Protocol", "Original approved source"]],
  sections: [
    {
      title: "Instructions",
      paragraphs: ["  Preserve original\nनमस्ते <script>alert(1)</script> & text  "],
      columns: [],
      rows: []
    }
  ],
  notices: []
};
const issued = {
  id: "10000000-0000-4000-8000-000000000003",
  revision: 1,
  sourceDigest: "0".repeat(64),
  rendererVersion: 1 as const,
  generatedAt: "2026-10-02T10:00:00.000Z",
  generatedBy: "Synthetic Staff",
  previousDocumentId: null
};
test("document v1 preserves source text safely without executable or remote content", () => {
  const html = renderPatientDocumentV1(source, issued);
  assert.match(html, /नमस्ते &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; text  /u);
  assert.doesNotMatch(html, /<script|<img|<link|<iframe|<form|href=|src=/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /Source status at generation/);
  assert.equal(html, renderPatientDocumentV1(JSON.parse(JSON.stringify(source)), issued));
  assert.match(renderPatientDocumentV1(source), /PREVIEW ONLY/);
  assert.doesNotMatch(html, /PREVIEW ONLY/);
  // v1 is an archived rendering contract: a template change requires a new version.
  assert.equal(
    createHash("sha256").update(html).digest("hex"),
    "65e97d260e775f0cfa1cf649f8abdd2ce412c45565f0a2749ff426d321262b68"
  );
});
test("document money and bounds never round, truncate or silently replace source content", () => {
  assert.equal(documentMoney(120050), "INR 1,200.50");
  assert.equal(documentMoney(1), "INR 0.01");
  for (const n of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN])
    assert.throws(() => documentMoney(n), RangeError);
  assert.throws(
    () => renderPatientDocumentV1({ ...source, patientName: "bad\u0000name" }),
    /encoding/
  );
  assert.throws(
    () => renderPatientDocumentV1({ ...source, patientName: "x".repeat(524289) }),
    /size/
  );
  assert.throws(
    () =>
      renderPatientDocumentV1({
        ...source,
        sections: [{ title: "bad", paragraphs: [], columns: ["One"], rows: [["Two", "cells"]] }]
      }),
    /rows/
  );
  assert.match(
    renderPatientDocumentV1({ ...source, patientName: "literal \\u0001" }),
    /literal \\u0001/
  );
});
