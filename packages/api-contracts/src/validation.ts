import { isCp2EventType, isCp3EventType } from "@clinic-os/domain";
import type { AuditActor, EventProvenanceSource } from "@clinic-os/domain";

export interface ContractValidationIssue {
  path: string;
  message: string;
}

export interface ContractValidationErrorBody {
  code: "CONTRACT_VALIDATION_FAILED";
  issues: ContractValidationIssue[];
}

export type ContractParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ContractValidationErrorBody };

export class ContractValidationError extends Error {
  readonly code = "CONTRACT_VALIDATION_FAILED";
  readonly issues: ContractValidationIssue[];

  constructor(issues: ContractValidationIssue[]) {
    super("Contract payload failed validation.");
    this.issues = issues;
  }
}

export interface RequestContext {
  tenantId: string;
  clinicId: string;
  actor: AuditActor;
  correlationId: string;
  requestId?: string;
}

export interface MutationRequestContext extends RequestContext {
  idempotencyKey: string;
}

export const ACQUISITION_SOURCES = [
  "whatsapp",
  "call",
  "walk_in",
  "practo",
  "google",
  "referral",
  "manual",
  "manual_import",
  "external_system"
] as const;

export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export interface SourceAttribution {
  source: AcquisitionSource;
  provenance: EventProvenanceSource;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function parseWithIssues<T>(
  input: unknown,
  parser: (record: Record<string, unknown>, issues: ContractValidationIssue[]) => T | null
): ContractParseResult<T> {
  const issues: ContractValidationIssue[] = [];
  const record = asRecord(input, "$", issues);

  if (!record) {
    return { success: false, error: { code: "CONTRACT_VALIDATION_FAILED", issues } };
  }

  const data = parser(record, issues);

  if (issues.length > 0 || !data) {
    return { success: false, error: { code: "CONTRACT_VALIDATION_FAILED", issues } };
  }

  return { success: true, data };
}

export function assertParsed<T>(result: ContractParseResult<T>): T {
  if (!result.success) {
    throw new ContractValidationError(result.error.issues);
  }

  return result.data;
}

export function asRecord(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[]
): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  issues.push({ path, message: "Expected an object." });
  return null;
}

export function ensureAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: ContractValidationIssue[]
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "Unknown field is not allowed." });
    }
  }
}

export function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { uuid?: boolean; phone?: boolean; dateOnly?: boolean; isoDateTime?: boolean } = {}
): string {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: `${path}.${key}`, message: "Required non-empty string." });
    return "";
  }

  const trimmed = value.trim();
  validateStringFormat(trimmed, `${path}.${key}`, issues, options);
  return trimmed;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { uuid?: boolean; phone?: boolean; dateOnly?: boolean; isoDateTime?: boolean } = {}
): string | undefined {
  const value = record[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    issues.push({ path: `${path}.${key}`, message: "Expected a string." });
    return undefined;
  }

  const trimmed = value.trim();
  validateStringFormat(trimmed, `${path}.${key}`, issues, options);
  return trimmed;
}

export function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({ path: `${path}.${key}`, message: "Expected a number." });
    return undefined;
  }

  if (options.integer && !Number.isInteger(value)) {
    issues.push({ path: `${path}.${key}`, message: "Expected an integer." });
  }

  if (options.min !== undefined && value < options.min) {
    issues.push({ path: `${path}.${key}`, message: `Expected >= ${options.min}.` });
  }

  if (options.max !== undefined && value > options.max) {
    issues.push({ path: `${path}.${key}`, message: `Expected <= ${options.max}.` });
  }

  return value;
}

export function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  const value = optionalNumber(record, key, path, issues, options);

  if (value === undefined) {
    issues.push({ path: `${path}.${key}`, message: "Required number." });
    return 0;
  }

  return value;
}

export function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[]
): boolean | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: "Expected a boolean." });
    return undefined;
  }

  return value;
}

export function requiredEnum<T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  values: T,
  issues: ContractValidationIssue[]
): T[number] {
  const value = requiredString(record, key, path, issues);

  if (value && !values.includes(value)) {
    issues.push({
      path: `${path}.${key}`,
      message: `Expected one of: ${values.join(", ")}.`
    });
  }

  return value as T[number];
}

export function optionalEnum<T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  values: T,
  issues: ContractValidationIssue[]
): T[number] | undefined {
  const value = optionalString(record, key, path, issues);

  if (value === undefined) {
    return undefined;
  }

  if (!values.includes(value)) {
    issues.push({
      path: `${path}.${key}`,
      message: `Expected one of: ${values.join(", ")}.`
    });
  }

  return value as T[number];
}

export function optionalRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[]
): Record<string, unknown> | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  return asRecord(value, `${path}.${key}`, issues) ?? undefined;
}

export function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { uuid?: boolean } = {}
): string[] | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: "Expected an array." });
    return undefined;
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      issues.push({
        path: `${path}.${key}[${index}]`,
        message: "Expected a non-empty string."
      });
      return "";
    }

    const trimmed = item.trim();
    validateStringFormat(trimmed, `${path}.${key}[${index}]`, issues, options);
    return trimmed;
  });
}

export function parseRequestContext(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[]
): RequestContext {
  const actorRecord = asRecord(record.actor, `${path}.actor`, issues) ?? {};
  ensureAllowedKeys(actorRecord, ["type", "id"], `${path}.actor`, issues);

  const actorType = requiredEnum(actorRecord, "type", `${path}.actor`, [
    "user",
    "system",
    "integration",
    "ai"
  ] as const, issues);
  const actorId = optionalString(actorRecord, "id", `${path}.actor`, issues);

  if (actorType !== "system" && !actorId) {
    issues.push({ path: `${path}.actor.id`, message: "Actor id is required for this actor type." });
  }

  const actor = actorId ? { type: actorType, id: actorId } : { type: actorType, id: "system" };

  const context: RequestContext = {
    tenantId: requiredString(record, "tenantId", path, issues, { uuid: true }),
    clinicId: requiredString(record, "clinicId", path, issues, { uuid: true }),
    actor,
    correlationId: requiredString(record, "correlationId", path, issues)
  };
  const requestId = optionalString(record, "requestId", path, issues);

  return requestId ? { ...context, requestId } : context;
}

export function parseMutationContext(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[]
): MutationRequestContext {
  const context = parseRequestContext(record, path, issues);

  return {
    ...context,
    idempotencyKey: requiredString(record, "idempotencyKey", path, issues)
  };
}

export function parseSourceAttribution(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[]
): SourceAttribution {
  const source = requiredEnum(record, "source", path, ACQUISITION_SOURCES, issues);
  const provenanceRecord = asRecord(record.provenance, `${path}.provenance`, issues) ?? {};
  const provenance = parseEventProvenanceSource(provenanceRecord, `${path}.provenance`, issues);

  if (
    ["external_system", "patient_message", "phone_call"].includes(provenance.kind) &&
    !provenance.providerKey
  ) {
    issues.push({
      path: `${path}.provenance.providerKey`,
      message: "Provider key is required for external, message, and phone-call provenance."
    });
  }

  if (source === "external_system" && provenance.kind !== "external_system") {
    issues.push({
      path: `${path}.provenance.kind`,
      message: "external_system source must use external_system provenance."
    });
  }

  return { source, provenance };
}

export function parseEventProvenanceSource(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[]
): EventProvenanceSource {
  ensureAllowedKeys(
    record,
    [
      "kind",
      "providerKey",
      "externalRef",
      "rawEventId",
      "campaign",
      "referralSource",
      "sourceRecordId",
      "capturedAt",
      "receivedAt"
    ],
    path,
    issues
  );

  const kind = requiredEnum(record, "kind", path, [
    "external_system",
    "manual_entry",
    "manual_import",
    "patient_message",
    "phone_call",
    "walk_in",
    "referral",
    "system"
  ] as const, issues);
  const source: EventProvenanceSource = { kind };

  addOptional(source, "providerKey", optionalString(record, "providerKey", path, issues));
  addOptional(source, "externalRef", optionalString(record, "externalRef", path, issues));
  addOptional(source, "rawEventId", optionalString(record, "rawEventId", path, issues));
  addOptional(source, "campaign", optionalString(record, "campaign", path, issues));
  addOptional(source, "referralSource", optionalString(record, "referralSource", path, issues));
  addOptional(source, "sourceRecordId", optionalString(record, "sourceRecordId", path, issues));
  addOptional(source, "capturedAt", optionalString(record, "capturedAt", path, issues, { isoDateTime: true }));
  addOptional(source, "receivedAt", optionalString(record, "receivedAt", path, issues, { isoDateTime: true }));

  return source;
}

export function parseCp2EventType(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[]
): string {
  const value = requiredString(record, key, path, issues);

  if (value && !isCp2EventType(value)) {
    issues.push({ path: `${path}.${key}`, message: "Expected a canonical Checkpoint 2 event type." });
  }

  return value;
}

export function parseCp3EventType(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ContractValidationIssue[]
): string {
  const value = requiredString(record, key, path, issues);

  if (value && !isCp3EventType(value)) {
    issues.push({ path: `${path}.${key}`, message: "Expected a canonical Checkpoint 3 event type." });
  }

  return value;
}

export function addOptional<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): asserts target is T & { [P in K]?: V } {
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
}

export function hasAnyOwnField(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

export function compareIsoDateTimes(start: string, end: string): number {
  return Date.parse(start) - Date.parse(end);
}

function validateStringFormat(
  value: string,
  path: string,
  issues: ContractValidationIssue[],
  options: { uuid?: boolean; phone?: boolean; dateOnly?: boolean; isoDateTime?: boolean }
): void {
  if (options.uuid && !UUID_PATTERN.test(value)) {
    issues.push({ path, message: "Expected UUID." });
  }

  if (options.phone && !E164_PATTERN.test(value)) {
    issues.push({ path, message: "Expected E.164 phone number." });
  }

  if (options.dateOnly && !DATE_ONLY_PATTERN.test(value)) {
    issues.push({ path, message: "Expected YYYY-MM-DD date." });
  }

  if (options.isoDateTime && Number.isNaN(Date.parse(value))) {
    issues.push({ path, message: "Expected ISO date-time." });
  }
}
