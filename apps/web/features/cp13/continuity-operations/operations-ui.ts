import type { PublicJsonObject, VersionedPublicResource } from "@clinic-os/api-client-generated";
import { formatInrMinor } from "../treatment-billing/billing-workflow";

export function dashboardMetric(key: string, value: number, currency: string): string {
  if (!Number.isFinite(value)) return "Unavailable";
  if (key.endsWith("Minor"))
    return currency === "INR" ? formatInrMinor(value) : "Amount unavailable";
  if (key.endsWith("BasisPoints")) return `${(value / 100).toFixed(2)}%`;
  return value.toLocaleString("en-IN");
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function word(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function label(value: unknown, ...keys: string[]): string {
  const row = object(value);
  return keys.map((key) => word(row[key])).find(Boolean) ?? "Unnamed record";
}

export function asVersioned(value: unknown): VersionedPublicResource | null {
  const row = object(value);
  return word(row.id) && number(row.rowVersion) !== null
    ? (value as VersionedPublicResource)
    : null;
}

export interface LabCaseDisplay {
  readonly case: VersionedPublicResource;
  readonly vendor: PublicJsonObject;
  readonly items: readonly PublicJsonObject[];
}

export function labCaseDisplay(value: unknown): LabCaseDisplay | null {
  const detail = object(value);
  const record = asVersioned(detail.labCase ?? value);
  if (!record) return null;
  return {
    case: record,
    vendor: object(detail.vendor) as PublicJsonObject,
    items: Array.isArray(detail.items) ? (detail.items as PublicJsonObject[]) : []
  };
}

export function ifMatch(record: VersionedPublicResource): string {
  return `"rv-${record.rowVersion}"`;
}

export function evidence(note: string): { note: string; source: "staff_manual" } {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("Describe what was observed or done before recording evidence.");
  return { note: trimmed, source: "staff_manual" };
}

export function isoInstant(value: string): string {
  // A datetime-local value contains no offset. Require an offset-bearing instant instead of
  // silently applying the browser timezone to a clinic workflow.
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    throw new Error(
      "Enter a date and time with an explicit offset, such as 2026-09-26T10:30+05:30."
    );
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid date and time.");
  return parsed.toISOString();
}

export function knownRejected(error: unknown): boolean {
  const row = object(error);
  const status = number(row.status);
  if (status === 409 && word(object(row.details).reason) === "idempotency_request_in_progress")
    return false;
  return status !== null && status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

export function errorMessage(error: unknown): string {
  const row = object(error);
  return (
    word(row.message) ||
    (error instanceof Error ? error.message : "The request outcome could not be confirmed.")
  );
}

export function createOperationsCommand() {
  let pending: { key: string; title: string; run: (key: string) => Promise<unknown> } | null = null;
  let inFlight: Promise<unknown> | null = null;
  return {
    hasPending: () => pending !== null,
    pendingTitle: () => pending?.title ?? null,
    recover(): Promise<unknown> | null {
      return pending ? this.execute(pending.title, pending.run) : null;
    },
    execute(title: string, run: (key: string) => Promise<unknown>): Promise<unknown> {
      if (inFlight) return Promise.reject(new Error("Another operation is still being recorded."));
      if (pending && pending.run !== run) {
        return Promise.reject(new Error("Resolve the earlier operation before starting another."));
      }
      pending ??= { key: crypto.randomUUID(), title, run };
      const action = pending;
      inFlight = Promise.resolve()
        .then(() => action.run(action.key))
        .then((result) => {
          pending = null;
          return result;
        })
        .catch((error: unknown) => {
          if (knownRejected(error)) pending = null;
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    }
  };
}

let activeScope: string | null = null;
let scopedCommand = createOperationsCommand();
export function operationsCommandForScope(scope: string) {
  if (scope !== activeScope) {
    // A clinic switch is a hard privacy boundary for the in-memory request closure.
    activeScope = scope;
    scopedCommand = createOperationsCommand();
  }
  return scopedCommand;
}
