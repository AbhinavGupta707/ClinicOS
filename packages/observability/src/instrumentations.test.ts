import { describe, expect, it } from "vitest";
import type { Span } from "@opentelemetry/api";
import {
  applyPhiSafeHttpSpan,
  applyPhiSafePostgresSpan,
  serializePhiSafeRedisCommand
} from "./instrumentations.js";

describe("official instrumentation redaction hooks", () => {
  it("overwrites raw SQL text and values with bounded operation metadata", () => {
    const captured = captureSpan();
    applyPhiSafePostgresSpan(
      captured.span,
      "SELECT * FROM patients WHERE full_name = 'Rhea Secret' AND token = 'secret'"
    );
    expect(captured.names).toEqual(["postgres.select"]);
    expect(captured.attributes).toEqual({
      "db.operation.name": "SELECT",
      "db.statement": "[REDACTED]",
      "db.query.text": "[REDACTED]"
    });
    expect(JSON.stringify(captured)).not.toMatch(/Rhea|patients|token|secret/u);
  });

  it("serializes Redis command verbs without keys or values", () => {
    expect(serializePhiSafeRedisCommand("set")).toBe("SET");
    expect(serializePhiSafeRedisCommand("patient-rhea-secret")).toBe("OTHER");
  });

  it("overwrites every HTTP URL/path/query attribute", () => {
    const captured = captureSpan();
    applyPhiSafeHttpSpan(captured.span);
    expect(captured.attributes).toEqual({
      "http.target": "[REDACTED]",
      "http.url": "[REDACTED]",
      "url.full": "[REDACTED]",
      "url.path": "[REDACTED]",
      "url.query": "[REDACTED]"
    });
  });
});

function captureSpan(): {
  readonly span: Span;
  readonly attributes: Record<string, unknown>;
  readonly names: string[];
} {
  const attributes: Record<string, unknown> = {};
  const names: string[] = [];
  const span = {
    updateName: (name: string) => {
      names.push(name);
      return span;
    },
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value;
      return span;
    }
  } as unknown as Span;
  return { span, attributes, names };
}
