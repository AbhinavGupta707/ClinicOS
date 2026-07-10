import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runObservabilityVerification,
  validateSyntheticTelemetryRecords,
  verifySyntheticTelemetry
} from "./cp14-observability-verify.mjs";

test("observability verifier rejects PHI or secrets hidden under generic allowed keys", () => {
  const input = validEvidence();
  input.logs[0].fields.status = "Patient Rhea token secret";
  const result = verifySyntheticTelemetry(input);
  assert.equal(result.status, "fail");
  assert.deepEqual(result.violationCodes, ["log_field_value_invalid"]);
  assert.doesNotMatch(JSON.stringify(result), /Patient|Rhea|token|secret/u);
});

test("evidence verification requires non-empty metrics, spans, and logs", () => {
  const result = verifySyntheticTelemetry({
    schemaVersion: 1,
    dataClassification: "synthetic-only",
    metrics: [],
    spans: [],
    logs: []
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.violationCodes, [
    "log_records_required",
    "metric_records_required",
    "span_records_required"
  ]);
  assert.equal(result.verificationMode, "evidence");
});

test("evidence records require identifying fields and aligned span identity", () => {
  const input = validEvidence();
  input.metrics = [{}];
  input.spans[0].attributes["clinic_os.operation"] = "read";
  input.logs = [{}];
  const result = verifySyntheticTelemetry(input);
  assert.equal(result.status, "fail");
  assert.ok(result.violationCodes.includes("metric_field_required"));
  assert.ok(result.violationCodes.includes("span_identity_mismatch"));
  assert.ok(result.violationCodes.includes("log_record_field_required"));
});

test("generic patient-name-like correlation IDs are rejected without echo", () => {
  for (const correlationId of ["PatientRhea", "synthetic-patientrhea"]) {
    const input = validEvidence();
    input.logs[0].fields.correlationId = correlationId;
    const result = verifySyntheticTelemetry(input);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.violationCodes, ["log_field_value_invalid"]);
    assert.doesNotMatch(JSON.stringify(result), /PatientRhea|synthetic-patientrhea/u);
  }
});

test("observability verifier rejects unbounded metric values and missing catalog attributes", () => {
  const metrics = Array.from({ length: 26 }, (_, index) => ({
    name: "clinic_os.http.requests",
    value: 1,
    attributes: { status: `value-${index}` }
  }));
  const result = validateSyntheticTelemetryRecords(
    { schemaVersion: 1, dataClassification: "synthetic-only", metrics },
    { maximumSeriesPerMetric: 25 }
  );
  assert.deepEqual(result.violationCodes, [
    "metric_attribute_required",
    "metric_attribute_value_invalid"
  ]);
  assert.equal(result.validationMode, "partial_unit");
});

test("observability verifier enforces a deterministic series cardinality ceiling", () => {
  const allowedStatuses = [
    "available",
    "completed",
    "degraded",
    "denied",
    "error",
    "failed",
    "failed_exhausted",
    "failed_permanent",
    "healthy",
    "not_configured",
    "processed",
    "quarantined",
    "retry_scheduled"
  ];
  const metrics = Array.from({ length: 26 }, (_, index) => ({
    name: "clinic_os.readiness",
    value: 1,
    attributes: {
      component: index < allowedStatuses.length ? "api" : "worker",
      status: allowedStatuses[index % allowedStatuses.length]
    }
  }));
  const result = validateSyntheticTelemetryRecords(
    { schemaVersion: 1, dataClassification: "synthetic-only", metrics },
    { maximumSeriesPerMetric: 25 }
  );
  assert.deepEqual(result.violationCodes, ["metric_cardinality_exceeded:clinic_os.readiness"]);
});

test("CLI authorization requires explicit synthetic environment, stop, and rollback controls", () => {
  const directory = mkdtempSync(join(tmpdir(), "clinicos-cp14-observability-"));
  const input = join(directory, "telemetry.json");
  writeFileSync(input, JSON.stringify(validEvidence()));
  assert.throws(
    () => runObservabilityVerification([`--input=${input}`]),
    /CP14_SYNTHETIC_ENVIRONMENT_REQUIRED/u
  );
  const result = runObservabilityVerification([
    "--environment=local",
    "--synthetic-only",
    `--stop-file=${join(directory, "stop")}`,
    "--rollback-plan=restart_local_target",
    `--input=${input}`
  ]);
  assert.equal(result.status, "pass");
  assert.equal(result.authorization.liveInfrastructureMutationAllowed, false);
});

function validEvidence() {
  return {
    schemaVersion: 1,
    dataClassification: "synthetic-only",
    metrics: [
      {
        name: "clinic_os.readiness",
        value: 1,
        attributes: { component: "worker", status: "healthy" }
      }
    ],
    spans: [
      {
        name: "clinic_os.worker.execute",
        status: "ok",
        attributes: {
          "clinic_os.domain": "worker",
          "clinic_os.operation": "execute"
        }
      }
    ],
    logs: [
      {
        timestamp: "2026-07-10T00:00:00.000Z",
        level: "info",
        message: "worker.health.started",
        fields: {
          service: "clinic-os-worker",
          environment: "test",
          event: "worker.health.started",
          status: "healthy",
          correlationId: "synthetic-request-0001"
        }
      }
    ]
  };
}
