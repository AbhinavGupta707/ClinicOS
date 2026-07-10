import { isClinicOsSessionUnavailable } from "@/lib/cp13-api-client";

export type TreatmentBillingPublicRecord = Readonly<Record<string, unknown>>;

/**
 * Consumer port implemented directly by the CP12 generated client. It deliberately contains no
 * route strings, fetch fallback, fixture mode, or alternate payload model.
 */
export interface TreatmentBillingGeneratedReadClient {
  listPricebookProcedures(): Promise<{
    readonly procedures: readonly TreatmentBillingPublicRecord[];
  }>;
  getInvoice(input: { readonly path: { readonly invoiceId: string } }): Promise<{
    readonly invoice: TreatmentBillingPublicRecord;
  }>;
}

export type TreatmentBillingWorkspaceState =
  | {
      readonly status: "ready";
      readonly procedures: readonly TreatmentBillingPublicRecord[];
      readonly invoice: TreatmentBillingPublicRecord | null;
      readonly loadedAt: string;
    }
  | {
      readonly status: "denied" | "unavailable" | "error";
      readonly code: string;
      readonly message: string;
      readonly requestId: string | null;
    };

export async function loadTreatmentBillingWorkspace(
  client: TreatmentBillingGeneratedReadClient,
  input: {
    readonly invoiceId?: string | null;
    readonly now?: () => Date;
  } = {}
): Promise<TreatmentBillingWorkspaceState> {
  try {
    const proceduresPromise = client.listPricebookProcedures();
    const invoicePromise = input.invoiceId
      ? client.getInvoice({ path: { invoiceId: input.invoiceId } })
      : Promise.resolve(null);
    const [proceduresResponse, invoiceResponse] = await Promise.all([
      proceduresPromise,
      invoicePromise
    ]);
    const loadedAt = (input.now ?? (() => new Date()))().toISOString();
    return {
      status: "ready",
      procedures: proceduresResponse.procedures,
      invoice: invoiceResponse?.invoice ?? null,
      loadedAt
    };
  } catch (error) {
    if (isClinicOsSessionUnavailable(error)) {
      return {
        status: "unavailable",
        code: error.code,
        message:
          "The authenticated session token provider is unavailable. No billing fixture was substituted.",
        requestId: null
      };
    }
    if (isGeneratedClientError(error)) {
      if (error.code === "PERMISSION_DENIED" || error.code === "UNAUTHENTICATED") {
        return {
          status: "denied",
          code: error.code,
          message: "Your verified clinic role cannot access treatment and billing data.",
          requestId: error.requestId
        };
      }
      if (error.code === "DEPENDENCY_UNAVAILABLE" || error.code === "CONFIGURATION_ERROR") {
        return {
          status: "unavailable",
          code: error.code,
          message:
            "Treatment and billing data is temporarily unavailable. No fixture data was substituted.",
          requestId: error.requestId
        };
      }
      return {
        status: "error",
        code: error.code,
        message: "Treatment and billing data could not be loaded safely.",
        requestId: error.requestId
      };
    }
    return {
      status: "error",
      code: "UNEXPECTED_CLIENT_ERROR",
      message: "Treatment and billing data could not be loaded safely.",
      requestId: null
    };
  }
}

function isGeneratedClientError(
  error: unknown
): error is Error & { readonly code: string; readonly requestId: string } {
  return (
    error instanceof Error &&
    error.name === "ClinicOsApiError" &&
    "code" in error &&
    typeof error.code === "string" &&
    "requestId" in error &&
    typeof error.requestId === "string"
  );
}
