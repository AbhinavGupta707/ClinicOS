import type { PublicJsonObject } from "@clinic-os/api-client-generated";

const FRONT_OFFICE_SURFACES = new Set(["today", "lead-inbox", "appointments", "patients", "intake"]);
const CLINICAL_SURFACES = new Set([
  "patient-profile",
  "consent",
  "returning-prep",
  "encounter",
  "dental-media"
]);
const BILLING_SURFACES = new Set(["checkout", "accounting"]);
const OPERATIONS_SURFACES = new Set(["tasks", "lab", "operations", "owner-control"]);

export function isCp13WorkspaceSurface(surfaceId: string): boolean {
  return (
    FRONT_OFFICE_SURFACES.has(surfaceId) ||
    CLINICAL_SURFACES.has(surfaceId) ||
    BILLING_SURFACES.has(surfaceId) ||
    OPERATIONS_SURFACES.has(surfaceId)
  );
}

export function isCp13BillingSurface(surfaceId: string): boolean {
  return BILLING_SURFACES.has(surfaceId);
}

export function isCp13ClinicalSurface(surfaceId: string): boolean {
  return CLINICAL_SURFACES.has(surfaceId);
}

export function isCp13OperationsSurface(surfaceId: string): boolean {
  return OPERATIONS_SURFACES.has(surfaceId);
}

export type PaymentIntentUiState =
  | { readonly status: "idle" }
  | { readonly status: "requesting" }
  | { readonly status: "pending"; readonly message: string }
  | { readonly status: "requested"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

export function paymentIntentState(response: {
  readonly paymentIntent?: PublicJsonObject;
  readonly paymentRequest?: PublicJsonObject;
}): PaymentIntentUiState {
  if (response.paymentIntent) {
    const raw = response.paymentIntent.status;
    const status = typeof raw === "string" ? raw : "pending_provider_request";
    return {
      status: "pending",
      message: `Payment intent recorded as ${status.replaceAll("_", " ")}. This is not payment confirmation.`
    };
  }
  return {
    status: "requested",
    message:
      "Provider request recorded. Payment remains unconfirmed until signed provider evidence is reconciled."
  };
}

export function clinicLocalDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const field = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = field("year");
  const month = field("month");
  const day = field("day");
  if (!year || !month || !day) throw new RangeError("Clinic timezone date is unavailable.");
  return `${year}-${month}-${day}`;
}
