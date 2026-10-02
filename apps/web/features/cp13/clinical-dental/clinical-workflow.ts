import type {
  JsonValue,
  PublicJsonObject,
  WritableJsonObject
} from "@clinic-os/api-client-generated";
import { fdiTooth, record, valueText } from "../shared/workflow-values";

export interface IntakeField {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "boolean" | "number" | "choice";
  readonly required: boolean;
  readonly choices: readonly string[];
}

export function intakeFields(template: PublicJsonObject): readonly IntakeField[] {
  const schema = record(template.schema);
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : []
  );
  const legacy = schema.fields;
  if (Array.isArray(legacy)) {
    if (
      !legacy.every(
        (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
      )
    ) {
      throw new Error("This intake template contains unsupported fields.");
    }
    return legacy.map((key) => ({
      key,
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (letter: string) => letter.toUpperCase()),
      kind: "text" as const,
      required: required.has(key),
      choices: []
    }));
  }
  const properties = record(schema.properties);
  const keys = Object.keys(properties);
  if (keys.length === 0) throw new Error("This intake template has no supported fields.");
  return keys.map((key) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new Error("Unsupported intake field.");
    const property = record(properties[key]);
    const values = property.enum;
    const choices =
      Array.isArray(values) && values.every((item) => typeof item === "string")
        ? (values as string[])
        : [];
    const type = valueText(property.type);
    const kind = choices.length
      ? "choice"
      : type === "boolean"
        ? "boolean"
        : type === "number" || type === "integer"
          ? "number"
          : type === "string"
            ? "text"
            : null;
    if (!kind) throw new Error(`The ${key} field needs a supported template editor.`);
    return {
      key,
      label: valueText(property.title) || key.replace(/([A-Z])/g, " $1"),
      kind,
      required: required.has(key),
      choices
    };
  });
}

export function intakeResponses(
  fields: readonly IntakeField[],
  values: Readonly<Record<string, string>>
): WritableJsonObject {
  const result: Record<string, JsonValue> = {};
  for (const field of fields) {
    const raw = (values[field.key] ?? "").trim();
    if (!raw && field.required) throw new Error(`${field.label} is required.`);
    if (!raw) continue;
    if (field.kind === "choice" && !field.choices.includes(raw))
      throw new Error(`Choose a valid ${field.label}.`);
    if (field.kind === "boolean" && raw !== "true" && raw !== "false")
      throw new Error(`Choose yes or no for ${field.label}.`);
    if (field.kind === "number" && (!Number.isFinite(Number(raw)) || raw.length > 32))
      throw new Error(`Enter a valid ${field.label}.`);
    result[field.key] =
      field.kind === "boolean" ? raw === "true" : field.kind === "number" ? Number(raw) : raw;
  }
  return result;
}

export interface MedicationInput {
  readonly name: string;
  readonly strength: string;
  readonly route: string;
  readonly frequency: string;
  readonly duration: string;
  readonly instructions: string;
}

export function prescriptionMedications(rows: readonly MedicationInput[]) {
  if (!rows.length) throw new Error("Add at least one medication.");
  return rows.map((row, index) => {
    const name = row.name.trim();
    const frequency = row.frequency.trim();
    const duration = row.duration.trim();
    if (!name || !frequency || !duration)
      throw new Error(`Medication ${index + 1} needs name, frequency and duration.`);
    return {
      name,
      frequency,
      duration,
      ...(row.strength.trim() ? { strength: row.strength.trim() } : {}),
      ...(row.route.trim() ? { route: row.route.trim() } : {}),
      ...(row.instructions.trim() ? { instructions: row.instructions.trim() } : {})
    };
  });
}

export function assertFdiTooth(value: string): string {
  const tooth = value.trim();
  if (!fdiTooth(tooth))
    throw new Error("Enter a valid two-digit FDI tooth number (11–48 or 51–85).");
  return tooth;
}

export function printClinicalDocument(title: string, lines: readonly string[]): void {
  const printWindow = window.open("", "_blank", "width=840,height=900");
  if (!printWindow) throw new Error("Allow the print window for this clinic document.");
  printWindow.opener = null;
  const heading = printWindow.document.createElement("h1");
  heading.textContent = title;
  printWindow.document.body.append(heading);
  for (const line of lines) {
    const paragraph = printWindow.document.createElement("p");
    paragraph.textContent = line;
    printWindow.document.body.append(paragraph);
  }
  printWindow.document.title = title;
  printWindow.focus();
  printWindow.print();
}
