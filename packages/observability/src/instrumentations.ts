import type { Span } from "@opentelemetry/api";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";

const redisCommands = new Set([
  "DEL",
  "EVAL",
  "EVALSHA",
  "EXPIRE",
  "GET",
  "HGET",
  "HSET",
  "INCR",
  "PING",
  "PTTL",
  "SET",
  "TTL"
]);
const postgresOperations = new Set([
  "BEGIN",
  "COMMIT",
  "DELETE",
  "INSERT",
  "ROLLBACK",
  "SELECT",
  "SET",
  "UPDATE",
  "WITH"
]);

/**
 * Official Node instrumentation with aggressive attribute replacement. Framework wiring must also
 * set the bounded route-family attributes through InstrumentationHooks; raw routes are never used.
 */
export function createPhiSafeAutoInstrumentations() {
  return [
    new HttpInstrumentation({
      headersToSpanAttributes: {},
      startIncomingSpanHook: () => safeHttpAttributes("server"),
      startOutgoingSpanHook: () => safeHttpAttributes("client"),
      requestHook: (span) => applyPhiSafeHttpSpan(span),
      responseHook: (span) => applyPhiSafeHttpSpan(span),
      requireParentforOutgoingSpans: true,
      redactedQueryParams: []
    }),
    new PgInstrumentation({
      enhancedDatabaseReporting: false,
      addSqlCommenterCommentToQueries: false,
      enableTraceContextPropagation: false,
      requireParentSpan: true,
      requestHook(span, information) {
        applyPhiSafePostgresSpan(span, information.query.text);
      }
    }),
    new RedisInstrumentation({
      requireParentSpan: true,
      dbStatementSerializer(commandName) {
        return serializePhiSafeRedisCommand(commandName);
      }
    }),
    new UndiciInstrumentation({
      requireParentforSpans: true,
      headersToSpanAttributes: {},
      startSpanHook: () => safeHttpAttributes("client"),
      requestHook(span) {
        applyPhiSafeHttpSpan(span);
        span.updateName("http.client");
      },
      responseHook(span) {
        applyPhiSafeHttpSpan(span);
      }
    })
  ] as const;
}

export function boundedPostgresOperation(queryText: string): string {
  const operation = /^\s*([A-Za-z]+)/u.exec(queryText)?.[1]?.toUpperCase() ?? "OTHER";
  return postgresOperations.has(operation) ? operation : "OTHER";
}

export function applyPhiSafePostgresSpan(span: Span, queryText: string): void {
  const operation = boundedPostgresOperation(queryText);
  span.updateName(`postgres.${operation.toLowerCase()}`);
  span.setAttribute("db.operation.name", operation);
  span.setAttribute("db.statement", "[REDACTED]");
  span.setAttribute("db.query.text", "[REDACTED]");
}

export function serializePhiSafeRedisCommand(commandName: string): string {
  const command = commandName.toUpperCase();
  return redisCommands.has(command) ? command : "OTHER";
}

export function applyPhiSafeHttpSpan(span: Span): void {
  for (const [key, value] of Object.entries(safeHttpAttributes())) {
    span.setAttribute(key, value);
  }
}

function safeHttpAttributes(kind?: "client" | "server") {
  return {
    ...(kind ? { "clinic_os.http.kind": kind } : {}),
    "http.target": "[REDACTED]",
    "http.url": "[REDACTED]",
    "url.full": "[REDACTED]",
    "url.path": "[REDACTED]",
    "url.query": "[REDACTED]"
  };
}
