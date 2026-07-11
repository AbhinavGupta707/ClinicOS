import { describe, expect, it } from "vitest";
import type { LogEntry } from "./logger.js";
import { createJsonLogger } from "./logger.js";
import { clinicOsMetricCatalog, sanitizeMetricAttributes } from "./metrics.js";
import { allowlistDiagnosticFields, redactForLogs } from "./redaction.js";

describe("diagnostic telemetry policy", () => {
  it("never emits free text, tokens, signed URLs, object keys, or identity fields", () => {
    const entries: LogEntry[] = [];
    const violations: string[] = [];
    const logger = createJsonLogger({
      service: "clinic-os-api",
      environment: "test",
      sink: (entry) => entries.push(entry),
      onPolicyViolation: (codes) => violations.push(...codes)
    });

    logger.error("Patient Rhea needs amoxicillin", {
      event: "media.scan.failed",
      status: "error",
      correlationId: "synthetic-correlation-0001",
      tenantId: "tenant-secret-001",
      clinicId: "clinic-secret-001",
      token: "bearer-secret",
      signedUrl: "https://storage.example/object?signature=secret",
      objectKey: "tenant/clinic/patient/image.jpg",
      freeText: "Patient Rhea needs amoxicillin"
    });

    const serialized = JSON.stringify(entries);
    expect(entries[0]?.message).toBe("media.scan.failed");
    expect(entries[0]?.fields).toMatchObject({
      service: "clinic-os-api",
      environment: "test",
      status: "error",
      correlationId: "synthetic-correlation-0001"
    });
    expect(serialized).not.toMatch(
      /Rhea|amoxicillin|bearer-secret|signature=|tenant-secret|clinic-secret|image\.jpg/u
    );
    expect(violations).toEqual(
      expect.arrayContaining([
        "field_not_allowed:tenantId",
        "field_not_allowed:clinicId",
        "field_not_allowed:token",
        "field_not_allowed:signedUrl",
        "field_not_allowed:objectKey",
        "field_not_allowed:freeText"
      ])
    );
  });

  it("uses recursive redaction for defensive legacy boundaries", () => {
    expect(
      redactForLogs({
        safe: "ok",
        nested: { authorizationHeader: "secret", sqlQuery: "SELECT raw_patient_value" },
        requestBody: { patientName: "Rhea" }
      })
    ).toEqual({
      safe: "ok",
      nested: { authorizationHeader: "[REDACTED]", sqlQuery: "[REDACTED]" },
      requestBody: "[REDACTED]"
    });
  });

  it("drops nested and unallowlisted log fields", () => {
    const result = allowlistDiagnosticFields({
      event: "worker.outbox.completed",
      status: "success",
      details: { patient: "synthetic" },
      durationMs: 14
    });
    expect(result.fields).toEqual({
      event: "worker.outbox.completed",
      status: "success",
      durationMs: 14
    });
    expect(result.violations).toEqual(["field_not_allowed:details"]);
  });

  it("drops patient-like correlation identifiers instead of emitting or hashing them", () => {
    const entries: LogEntry[] = [];
    const violations: string[] = [];
    const logger = createJsonLogger({
      service: "clinic-os-api",
      environment: "test",
      sink: (entry) => entries.push(entry),
      onPolicyViolation: (codes) => violations.push(...codes)
    });

    for (const correlationId of ["PatientRhea", "synthetic-patientrhea"]) {
      logger.info("ignored free text", {
        event: "http.request.completed",
        correlationId
      });
    }

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => !("correlationId" in entry.fields))).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/PatientRhea|synthetic-patientrhea/u);
    expect(violations).toEqual([
      "field_value_not_allowed:correlationId",
      "field_value_not_allowed:correlationId"
    ]);
  });
});

describe("bounded metric attributes", () => {
  it("drops tenant and clinic identifiers and buckets unbounded taxonomy values", () => {
    const definition = clinicOsMetricCatalog.find(
      (candidate) => candidate.name === "worker.outbox.event.processed"
    );
    expect(definition).toBeDefined();
    const result = sanitizeMetricAttributes(definition!, {
      tenantId: "tenant-001",
      clinicId: "clinic-001",
      eventType: "patient.synthetic.free_text.created",
      status: "processed"
    });

    expect(result.attributes).toEqual({ eventType: "other", status: "processed" });
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "metric_attribute_not_allowed:tenantId",
        "metric_attribute_not_allowed:clinicId",
        "metric_attribute_value_bucketed:eventType"
      ])
    );
  });
});
