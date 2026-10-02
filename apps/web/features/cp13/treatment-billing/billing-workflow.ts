import type {
  JsonValue,
  PublicJsonObject,
  VersionedPublicResource
} from "@clinic-os/api-client-generated";
import { fieldText, record, valueList } from "../shared/workflow-values";

export interface PlanItemDraft {
  pricebookProcedureId: string;
  toothNumber: string;
  quantity: string;
  estimatedVisits: string;
  notes: string;
}

export interface PlanPhaseDraft {
  title: string;
  description: string;
  estimatedStartAfterDays: string;
  items: PlanItemDraft[];
}

export function blankPlanItem(): PlanItemDraft {
  return {
    pricebookProcedureId: "",
    toothNumber: "",
    quantity: "1",
    estimatedVisits: "1",
    notes: ""
  };
}

export function blankPlanPhase(): PlanPhaseDraft {
  return { title: "", description: "", estimatedStartAfterDays: "", items: [blankPlanItem()] };
}

function positiveInt(value: string, label: string): number {
  if (!/^[1-9]\d{0,5}$/.test(value.trim()))
    throw new Error(`${label} must be a positive whole number.`);
  return Number(value.trim());
}

export function planPhases(
  drafts: readonly PlanPhaseDraft[],
  allowedProcedureIds: ReadonlySet<string>
) {
  if (!drafts.length) throw new Error("Add at least one treatment phase.");
  return drafts.map((phase, phaseIndex) => {
    if (!phase.title.trim()) throw new Error(`Phase ${phaseIndex + 1} needs a title.`);
    if (!phase.items.length) throw new Error(`Phase ${phaseIndex + 1} needs an item.`);
    const estimatedStartAfterDays = phase.estimatedStartAfterDays.trim();
    if (estimatedStartAfterDays && !/^(0|[1-9]\d{0,5})$/.test(estimatedStartAfterDays)) {
      throw new Error(`Phase ${phaseIndex + 1} needs a valid day offset.`);
    }
    return {
      title: phase.title.trim(),
      description: phase.description.trim() || undefined,
      estimatedStartAfterDays: estimatedStartAfterDays
        ? Number(estimatedStartAfterDays)
        : undefined,
      items: phase.items.map((item, itemIndex) => {
        if (!allowedProcedureIds.has(item.pricebookProcedureId)) {
          throw new Error(
            `Choose an active catalog procedure for phase ${phaseIndex + 1}, item ${itemIndex + 1}.`
          );
        }
        const toothNumber = item.toothNumber.trim();
        if (toothNumber && !/^(?:[1-4][1-8]|[5-8][1-5])$/.test(toothNumber)) {
          throw new Error(
            `Phase ${phaseIndex + 1}, item ${itemIndex + 1} needs a valid FDI tooth number.`
          );
        }
        return {
          pricebookProcedureId: item.pricebookProcedureId,
          toothNumber: toothNumber || undefined,
          quantity: positiveInt(item.quantity, "Quantity"),
          estimatedVisits: positiveInt(item.estimatedVisits, "Estimated visits"),
          notes: item.notes.trim() || undefined
        };
      })
    };
  });
}

export function planDraftFromResource(plan: VersionedPublicResource): {
  title: string;
  clinicalSummary: string;
  phases: PlanPhaseDraft[];
} {
  return {
    title: fieldText(plan, "title"),
    clinicalSummary: fieldText(plan, "clinicalSummary"),
    phases: valueList(plan.phases).map((phaseValue) => {
      const phase = record(phaseValue);
      return {
        title: fieldText(phase, "title"),
        description: fieldText(phase, "description"),
        estimatedStartAfterDays:
          typeof phase.estimatedStartAfterDays === "number"
            ? String(phase.estimatedStartAfterDays)
            : "",
        items: valueList(phase.estimateItems).map((itemValue) => {
          const item = record(itemValue);
          return {
            pricebookProcedureId: fieldText(item, "pricebookProcedureId"),
            toothNumber: fieldText(item, "toothNumber"),
            quantity: String(item.quantity ?? 1),
            estimatedVisits: String(item.estimatedVisits ?? 1),
            notes: fieldText(item, "notes")
          };
        })
      };
    })
  };
}

export function acceptedIncompleteItems(plan: VersionedPublicResource): PublicJsonObject[] {
  if (fieldText(plan, "status") !== "accepted") return [];
  return valueList(plan.phases)
    .flatMap((phaseValue) => valueList(record(phaseValue).estimateItems))
    .map(record)
    .filter((item) => fieldText(item, "status") === "accepted" && !!fieldText(item, "id"));
}

export function parseInrMinor(value: string, allowZero = false): number {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter an INR amount with at most two decimal places.");
  }
  const [rupees, paise = ""] = trimmed.split(".");
  const minor = BigInt(rupees!) * 100n + BigInt((paise + "00").slice(0, 2));
  if (minor < (allowZero ? 0n : 1n) || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(
      allowZero
        ? "Enter a non-negative amount within the supported range."
        : "Enter a positive amount within the supported range."
    );
  return Number(minor);
}

export function formatInrMinor(value: JsonValue | undefined): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return "Amount unavailable";
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  return `${sign}₹${Math.floor(absolute / 100).toLocaleString("en-IN")}.${String(absolute % 100).padStart(2, "0")}`;
}

export function receiptablePayments(invoice: PublicJsonObject): PublicJsonObject[] {
  return valueList(invoice.payments)
    .map(record)
    .filter(
      (payment) =>
        !fieldText(payment, "receiptId") &&
        ((fieldText(payment, "status") === "manually_recorded" &&
          fieldText(payment, "verificationStatus") === "not_required_manual") ||
          (fieldText(payment, "status") === "succeeded" &&
            fieldText(payment, "verificationStatus") === "verified"))
    );
}
