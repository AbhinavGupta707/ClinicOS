import type { SafeDiagnosticEvent, SafeDiagnosticSink } from "./types.ts";

const allowedKeys = new Set([
  "code",
  "at",
  "attemptCount",
  "queueDepth",
  "captureKind"
]);

export function assertSafeDiagnostic(event: SafeDiagnosticEvent): void {
  for (const key of Object.keys(event)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Unsafe diagnostic field: ${key}`);
  }
  const serialized = JSON.stringify(event);
  if (
    /patient|encounter|tenant|clinic|token|secret|authorization|object.?key|file:\/|https?:\/\//i.test(
      serialized
    )
  ) {
    throw new TypeError("Diagnostic event contains a prohibited identifier or secret-shaped field.");
  }
}

export class BoundedDiagnosticBuffer implements SafeDiagnosticSink {
  readonly #events: SafeDiagnosticEvent[] = [];
  readonly #capacity: number;

  constructor(capacity = 100) {
    this.#capacity = Math.max(1, Math.min(capacity, 500));
  }

  record(event: SafeDiagnosticEvent): void {
    assertSafeDiagnostic(event);
    this.#events.push({ ...event });
    if (this.#events.length > this.#capacity) this.#events.shift();
  }

  snapshot(): readonly SafeDiagnosticEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }
}
