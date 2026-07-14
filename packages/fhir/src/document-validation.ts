import {
  CLINIC_OS_CLINICAL_SUMMARY_PROFILE,
  CLINIC_OS_FHIR_R4_CORE_PROFILES,
  CLINIC_OS_SUPPORTED_DOCUMENT_RESOURCE_TYPES
} from "./capability.ts";
import {
  CLINIC_OS_IDENTIFIER_SYSTEMS,
  CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM,
  CLINIC_OS_INTEROPERABILITY_PURPOSE_SYSTEM,
  patientIdentifierSystem
} from "./clinical-summary.ts";
import { ClinicOsFhirError, type ClinicOsFhirIssueInput } from "./operation-outcome.ts";
import type {
  FhirBundle,
  FhirIdentifier,
  FhirOperationOutcome,
  FhirResource,
  FhirResourceType
} from "./types.ts";

export const DEFAULT_CLINICAL_SUMMARY_IMPORT_BOUNDS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 24,
  maxEntries: 256,
  maxObjectKeys: 20_000,
  maxStringLength: 20_000,
  maxStrings: 10_000
});

export interface ClinicalSummaryImportBounds {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
  readonly maxStrings: number;
}

export interface ClinicalSummaryDocumentValidationResult {
  readonly bundle: FhirBundle | null;
  readonly outcome: FhirOperationOutcome | null;
  readonly valid: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_KEYS = new Set([
  "contained",
  "extension",
  "implicitRules",
  "modifierExtension",
  "__proto__",
  "prototype",
  "constructor"
]);
const BUNDLE_FIELDS = fields(
  "resourceType",
  "id",
  "identifier",
  "meta",
  "timestamp",
  "type",
  "entry"
);
const BUNDLE_ENTRY_FIELDS = fields("fullUrl", "resource");
const IMPORT_FIELD_NAMES = fields(
  ...BUNDLE_FIELDS,
  ...BUNDLE_ENTRY_FIELDS,
  "action",
  "active",
  "activity",
  "agent",
  "appointment",
  "attachment",
  "author",
  "authoredOn",
  "birthDate",
  "category",
  "class",
  "code",
  "coding",
  "content",
  "contentType",
  "context",
  "creation",
  "custodian",
  "data",
  "dataPeriod",
  "date",
  "dateTime",
  "description",
  "display",
  "div",
  "docStatus",
  "dosageInstruction",
  "encounter",
  "end",
  "entity",
  "gender",
  "hash",
  "individual",
  "intent",
  "lastUpdated",
  "managingOrganization",
  "meaning",
  "medicationCodeableConcept",
  "name",
  "note",
  "occurredDateTime",
  "onBehalfOf",
  "organization",
  "partOf",
  "participant",
  "patient",
  "performer",
  "period",
  "policy",
  "profile",
  "provision",
  "purpose",
  "reason",
  "reasonCode",
  "recorded",
  "reference",
  "related",
  "relatesTo",
  "requester",
  "role",
  "scope",
  "section",
  "security",
  "securityLabel",
  "serviceProvider",
  "source",
  "start",
  "status",
  "subject",
  "system",
  "tag",
  "target",
  "telecom",
  "text",
  "title",
  "type",
  "url",
  "use",
  "value",
  "versionId",
  "what",
  "who"
);
const ALLOWED_SYSTEMS = new Set([
  ...Object.values(CLINIC_OS_IDENTIFIER_SYSTEMS),
  CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM,
  CLINIC_OS_INTEROPERABILITY_PURPOSE_SYSTEM,
  "http://hl7.org/fhir/resource-types",
  "http://loinc.org",
  "http://terminology.hl7.org/CodeSystem/consentscope",
  "http://terminology.hl7.org/CodeSystem/restful-security-service",
  "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
  "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
  "https://nrces.in/ndhm/fhir/r4/CodeSystem/hpr-id"
]);
const RESOURCE_FIELDS: Readonly<Record<FhirResource["resourceType"], ReadonlySet<string>>> = {
  Composition: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "status",
    "type",
    "subject",
    "encounter",
    "date",
    "author",
    "title",
    "custodian",
    "section"
  ),
  Consent: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "status",
    "scope",
    "category",
    "patient",
    "dateTime",
    "performer",
    "organization",
    "provision"
  ),
  DocumentReference: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "status",
    "docStatus",
    "type",
    "subject",
    "date",
    "author",
    "description",
    "securityLabel",
    "content",
    "context",
    "relatesTo"
  ),
  Encounter: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "status",
    "class",
    "subject",
    "participant",
    "period",
    "reasonCode",
    "serviceProvider",
    "appointment"
  ),
  MedicationRequest: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "status",
    "intent",
    "medicationCodeableConcept",
    "subject",
    "encounter",
    "authoredOn",
    "requester",
    "dosageInstruction",
    "note"
  ),
  Organization: fields("resourceType", "id", "meta", "identifier", "active", "name", "partOf"),
  Patient: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "active",
    "name",
    "gender",
    "birthDate",
    "managingOrganization",
    "telecom"
  ),
  Practitioner: fields("resourceType", "id", "meta", "identifier", "active", "name", "telecom"),
  Provenance: fields(
    "resourceType",
    "id",
    "meta",
    "identifier",
    "target",
    "occurredDateTime",
    "recorded",
    "policy",
    "reason",
    "activity",
    "agent",
    "entity"
  )
};

export function parseClinicalSummaryDocument(
  raw: Uint8Array | string,
  bounds: ClinicalSummaryImportBounds = DEFAULT_CLINICAL_SUMMARY_IMPORT_BOUNDS
): FhirBundle {
  assertBounds(bounds);
  const byteLength = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (byteLength === 0 || byteLength > bounds.maxBytes) {
    throw validationError(
      [
        issue(
          byteLength === 0 ? "FHIR_BODY_REQUIRED" : "FHIR_BODY_TOO_LARGE",
          byteLength === 0
            ? "A FHIR document body is required."
            : `FHIR document body exceeds the ${bounds.maxBytes} byte limit.`,
          "Bundle",
          byteLength === 0 ? "required" : "too-costly"
        )
      ],
      byteLength === 0 ? 400 : 413
    );
  }
  let jsonText: string;
  try {
    jsonText =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw validationError(
      [issue("FHIR_UTF8_INVALID", "FHIR JSON must be valid UTF-8.", "Bundle", "structure")],
      400
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw validationError(
      [issue("FHIR_JSON_INVALID", "FHIR body must be valid JSON.", "Bundle", "structure")],
      400
    );
  }
  scanBounds(parsed, bounds);
  const result = validateClinicalSummaryDocument(parsed, bounds);
  if (!result.valid && result.outcome) {
    throw new ClinicOsFhirError({ httpStatus: 422, issues: result.outcome.issue.map(fromIssue) });
  }
  if (!result.bundle) {
    throw validationError(
      [issue("FHIR_BUNDLE_INVALID", "FHIR document Bundle is invalid.", "Bundle", "structure")],
      422
    );
  }
  return result.bundle;
}

export function validateClinicalSummaryDocument(
  value: unknown,
  bounds: ClinicalSummaryImportBounds = DEFAULT_CLINICAL_SUMMARY_IMPORT_BOUNDS
): ClinicalSummaryDocumentValidationResult {
  const issues: ClinicOsFhirIssueInput[] = [];
  if (!isRecord(value)) {
    issues.push(
      issue("FHIR_BUNDLE_INVALID", "The document root must be an object.", "Bundle", "structure")
    );
    return invalid(issues);
  }
  if (value.resourceType !== "Bundle") {
    issues.push(
      issue("FHIR_BUNDLE_REQUIRED", "resourceType must be Bundle.", "Bundle.resourceType", "value")
    );
  }
  validateObjectFields(value, BUNDLE_FIELDS, "Bundle", issues);
  if (value.type !== "document") {
    issues.push(
      issue(
        "FHIR_DOCUMENT_BUNDLE_REQUIRED",
        "Bundle.type must be document.",
        "Bundle.type",
        "value"
      )
    );
  }
  if (!uuid(value.id)) {
    issues.push(
      issue(
        "FHIR_BUNDLE_ID_INVALID",
        "Bundle.id must be a UUID-backed FHIR id.",
        "Bundle.id",
        "value"
      )
    );
  }
  const bundleIdentifier = value.identifier;
  if (
    !isRecord(bundleIdentifier) ||
    bundleIdentifier.system !== CLINIC_OS_IDENTIFIER_SYSTEMS.bundle ||
    !requiredString(bundleIdentifier.value)
  ) {
    issues.push(
      issue(
        "FHIR_BUNDLE_IDENTIFIER_REQUIRED",
        "Document Bundle.identifier requires the supported system and a value.",
        "Bundle.identifier",
        "required"
      )
    );
  }
  if (!validDateTime(value.timestamp)) {
    issues.push(
      issue(
        "FHIR_BUNDLE_TIMESTAMP_INVALID",
        "Bundle.timestamp is required and must include an offset.",
        "Bundle.timestamp",
        "value"
      )
    );
  }
  if (!profileIncludes(value.meta, CLINIC_OS_CLINICAL_SUMMARY_PROFILE)) {
    issues.push(
      issue(
        "FHIR_BUNDLE_PROFILE_REQUIRED",
        "Bundle.meta.profile must declare the supported R4 Bundle profile.",
        "Bundle.meta.profile",
        "required"
      )
    );
  }
  if (!Array.isArray(value.entry) || value.entry.length === 0) {
    issues.push(
      issue("FHIR_ENTRY_REQUIRED", "Bundle.entry must not be empty.", "Bundle.entry", "required")
    );
    return invalid(issues);
  }
  if (value.entry.length > bounds.maxEntries) {
    issues.push(
      issue(
        "FHIR_ENTRY_LIMIT_EXCEEDED",
        `Bundle.entry exceeds the ${bounds.maxEntries} resource limit.`,
        "Bundle.entry",
        "too-costly"
      )
    );
  }

  const resourceKeys = new Set<string>();
  const fullUrls = new Set<string>();
  const references: Array<{ path: string; reference: string }> = [];
  const counts = new Map<string, number>();
  const resources: FhirResource[] = [];
  for (const [index, entry] of value.entry.entries()) {
    const path = `Bundle.entry[${index}]`;
    if (!isRecord(entry) || !isRecord(entry.resource)) {
      issues.push(
        issue(
          "FHIR_ENTRY_RESOURCE_REQUIRED",
          "Every Bundle entry must contain a resource.",
          `${path}.resource`,
          "required"
        )
      );
      continue;
    }
    validateObjectFields(entry, BUNDLE_ENTRY_FIELDS, path, issues);
    const resourceType = entry.resource.resourceType;
    if (!supportedResourceType(resourceType)) {
      issues.push(
        issue(
          "FHIR_RESOURCE_NOT_ALLOWED",
          "Bundle contains a resource type outside the clinical-summary allowlist.",
          `${path}.resource.resourceType`,
          "not-supported"
        )
      );
      continue;
    }
    if (!uuid(entry.resource.id)) {
      issues.push(
        issue(
          "FHIR_RESOURCE_ID_INVALID",
          `${resourceType}.id must be a UUID-backed FHIR id.`,
          `${path}.resource.id`,
          "value"
        )
      );
      continue;
    }
    const resourceKey = `${resourceType}/${entry.resource.id}`;
    const expectedFullUrl = `urn:uuid:${entry.resource.id}`;
    if (entry.fullUrl !== expectedFullUrl) {
      issues.push(
        issue(
          "FHIR_FULL_URL_INVALID",
          `Bundle entry fullUrl must be ${expectedFullUrl}.`,
          `${path}.fullUrl`,
          "value"
        )
      );
    }
    if (
      resourceKeys.has(resourceKey) ||
      (requiredString(entry.fullUrl) && fullUrls.has(entry.fullUrl))
    ) {
      issues.push(
        issue(
          "FHIR_RESOURCE_DUPLICATE",
          "Bundle resource ids and fullUrl values must be unique.",
          path,
          "duplicate"
        )
      );
    }
    resourceKeys.add(resourceKey);
    if (requiredString(entry.fullUrl)) fullUrls.add(entry.fullUrl);
    counts.set(resourceType, (counts.get(resourceType) ?? 0) + 1);
    if (!profileIncludes(entry.resource.meta, CLINIC_OS_FHIR_R4_CORE_PROFILES[resourceType])) {
      issues.push(
        issue(
          "FHIR_RESOURCE_PROFILE_REQUIRED",
          `${resourceType}.meta.profile must declare its supported FHIR R4 core profile.`,
          `${path}.resource.meta.profile`,
          "required"
        )
      );
    }
    validateResourceFieldAllowlist(entry.resource, path, issues);
    collectReferences(entry.resource, `${path}.resource`, references);
    if (validResourceShape(entry.resource)) {
      resources.push(entry.resource as unknown as FhirResource);
    } else {
      issues.push(
        issue(
          "FHIR_RESOURCE_SHAPE_INVALID",
          `${resourceType} contains missing or malformed fields for the supported profile.`,
          `${path}.resource`,
          "structure"
        )
      );
    }
  }
  if (resources[0]?.resourceType !== "Composition") {
    issues.push(
      issue(
        "FHIR_COMPOSITION_FIRST",
        "A document Bundle must contain Composition as its first resource.",
        "Bundle.entry[0].resource",
        "structure"
      )
    );
  }
  validateCounts(counts, issues);
  validateReferences(references, resourceKeys, fullUrls, issues);
  validateResourceSemantics(resources, issues);
  validateDocumentGraph(resources, issues);
  validateUriSurface(value, issues);
  if (issues.length > 0) return invalid(issues);
  return {
    bundle: value as unknown as FhirBundle,
    valid: true,
    outcome: null
  };
}

export function assertClinicalSummaryAuthorizedScope(
  bundle: FhirBundle,
  scope: {
    readonly clinicId: string;
    readonly patientId?: string;
    readonly tenantId: string;
  }
): void {
  const tenants = bundle.entry
    .map((entry) => entry.resource)
    .filter(
      (resource) =>
        resource.resourceType === "Organization" &&
        resource.id === scope.tenantId &&
        hasIdentifier(resource.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.tenant, scope.tenantId)
    );
  const clinics = bundle.entry
    .map((entry) => entry.resource)
    .filter(
      (resource) =>
        resource.resourceType === "Organization" &&
        resource.id === scope.clinicId &&
        hasIdentifier(resource.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.clinic, scope.clinicId)
    );
  const patient = bundle.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Patient");
  const expectedPatientSystem = patientIdentifierSystem(scope.tenantId, scope.clinicId);
  const patientMatches =
    patient?.resourceType === "Patient" &&
    patient.identifier?.some(
      (identifier) =>
        identifier.system === expectedPatientSystem &&
        (!scope.patientId || identifier.value === scope.patientId)
    );
  if (
    tenants.length !== 1 ||
    clinics.length !== 1 ||
    tenants[0]?.id === clinics[0]?.id ||
    !patientMatches
  ) {
    throw validationError(
      [
        issue(
          "FHIR_SCOPE_MISMATCH",
          "FHIR document tenant, clinic or patient identifiers do not match the authorized request scope.",
          "Bundle.entry.resource.identifier",
          "forbidden"
        )
      ],
      403
    );
  }
}

export function clinicalSummaryPatientIdentifiers(bundle: FhirBundle): FhirIdentifier[] {
  const patient = bundle.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Patient");
  return patient?.resourceType === "Patient"
    ? (patient.identifier ?? []).map((identifier) => ({ ...identifier }))
    : [];
}

function validateCounts(
  counts: ReadonlyMap<string, number>,
  issues: ClinicOsFhirIssueInput[]
): void {
  const exact: Readonly<Record<string, number>> = {
    Composition: 1,
    Consent: 1,
    DocumentReference: 1,
    Encounter: 1,
    Patient: 1,
    Practitioner: 1,
    Provenance: 1,
    Organization: 2
  };
  for (const [resourceType, expected] of Object.entries(exact)) {
    if ((counts.get(resourceType) ?? 0) !== expected) {
      issues.push(
        issue(
          "FHIR_RESOURCE_CARDINALITY",
          `Clinical summary requires exactly ${expected} ${resourceType} resource(s).`,
          "Bundle.entry",
          "structure"
        )
      );
    }
  }
}

function validateReferences(
  references: readonly { path: string; reference: string }[],
  resourceKeys: ReadonlySet<string>,
  fullUrls: ReadonlySet<string>,
  issues: ClinicOsFhirIssueInput[]
): void {
  for (const item of references) {
    if (/^[A-Za-z]+\/[0-9a-f-]{36}$/iu.test(item.reference)) {
      if (!resourceKeys.has(item.reference)) {
        issues.push(
          issue(
            "FHIR_REFERENCE_MISSING",
            "A local FHIR reference does not resolve within the document Bundle.",
            item.path,
            "not-found"
          )
        );
      }
      continue;
    }
    if (item.reference.startsWith("urn:uuid:")) {
      if (!fullUrls.has(item.reference)) {
        issues.push(
          issue(
            "FHIR_REFERENCE_MISSING",
            "A urn:uuid reference does not resolve within the document Bundle.",
            item.path,
            "not-found"
          )
        );
      }
      continue;
    }
    issues.push(
      issue(
        "FHIR_EXTERNAL_REFERENCE_FORBIDDEN",
        "External, contained, versioned and conditional references are not supported for this closed document.",
        item.path,
        "forbidden"
      )
    );
  }
}

function validateResourceSemantics(
  resources: readonly FhirResource[],
  issues: ClinicOsFhirIssueInput[]
): void {
  for (const resource of resources) {
    const path = `${resource.resourceType}/${resource.id}`;
    switch (resource.resourceType) {
      case "Composition":
        if (!(["final", "amended"] as const).includes(resource.status as "final" | "amended"))
          semantic(
            issues,
            "FHIR_COMPOSITION_STATUS",
            "Composition.status must be final or amended.",
            `${path}.status`
          );
        if (!coding(resource.type, "http://loinc.org", "34133-9"))
          semantic(
            issues,
            "FHIR_COMPOSITION_TYPE",
            "Composition.type must be LOINC 34133-9.",
            `${path}.type`
          );
        if (!resource.author?.length || !resource.section?.length || !resource.custodian)
          semantic(
            issues,
            "FHIR_COMPOSITION_REQUIRED_FIELDS",
            "Composition requires author, custodian and at least one section.",
            path
          );
        break;
      case "Consent":
        if (resource.status !== "active")
          semantic(
            issues,
            "FHIR_CONSENT_STATUS",
            "Consent.status must be active.",
            `${path}.status`
          );
        if (
          !coding(
            resource.scope,
            "http://terminology.hl7.org/CodeSystem/consentscope",
            "patient-privacy"
          )
        )
          semantic(
            issues,
            "FHIR_CONSENT_SCOPE",
            "Consent.scope must be patient-privacy.",
            `${path}.scope`
          );
        if (!resource.category.some((category) => coding(category, "http://loinc.org", "59284-0")))
          semantic(
            issues,
            "FHIR_CONSENT_CATEGORY",
            "Consent.category must include LOINC 59284-0.",
            `${path}.category`
          );
        if (
          resource.provision?.type !== "permit" ||
          !resource.provision.purpose?.some(
            (purpose) =>
              purpose.system === CLINIC_OS_INTEROPERABILITY_PURPOSE_SYSTEM &&
              purpose.code === "encounter-clinical-summary"
          )
        )
          semantic(
            issues,
            "FHIR_CONSENT_PROVISION",
            "Consent.provision must permit the encounter clinical-summary purpose.",
            `${path}.provision`
          );
        if (
          !resource.provision?.action?.some((action) =>
            coding(action, CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM, "clinical_summary_export")
          ) ||
          !resource.provision.class?.some(
            (item) => item.system === "http://hl7.org/fhir/resource-types" && item.code === "Bundle"
          )
        )
          semantic(
            issues,
            "FHIR_CONSENT_ACTION",
            "Consent.provision must authorize the exported Bundle action and class.",
            `${path}.provision.action`
          );
        break;
      case "Encounter":
        if (resource.status !== "finished")
          semantic(
            issues,
            "FHIR_ENCOUNTER_STATUS",
            "Encounter.status must be finished for this summary.",
            `${path}.status`
          );
        if (
          resource.class.system !== "http://terminology.hl7.org/CodeSystem/v3-ActCode" ||
          resource.class.code !== "AMB"
        )
          semantic(
            issues,
            "FHIR_ENCOUNTER_CLASS",
            "Encounter.class must be the ambulatory AMB code.",
            `${path}.class`
          );
        if (
          !hasIdentifier(resource.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.encounter, resource.id)
        )
          semantic(
            issues,
            "FHIR_ENCOUNTER_IDENTIFIER",
            "Encounter requires the supported ClinicOS identifier matching its resource id.",
            `${path}.identifier`
          );
        break;
      case "MedicationRequest":
        if (
          resource.status !== "active" ||
          resource.intent !== "order" ||
          !requiredString(resource.medicationCodeableConcept.text)
        )
          semantic(
            issues,
            "FHIR_MEDICATION_REQUEST_INVALID",
            "MedicationRequest requires active status, order intent and medication text.",
            path
          );
        if (!hasIdentifierSystem(resource.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.prescription))
          semantic(
            issues,
            "FHIR_MEDICATION_IDENTIFIER",
            "MedicationRequest requires the supported prescription identifier namespace.",
            `${path}.identifier`
          );
        break;
      case "Patient":
        if (!resource.identifier?.length || !resource.name?.length)
          semantic(
            issues,
            "FHIR_PATIENT_REQUIRED_FIELDS",
            "Patient requires an exact identifier and name.",
            path
          );
        if (
          !resource.identifier?.some((identifier) =>
            /^https:\/\/fhir\.clinicos\.in\/NamingSystem\/tenant\/[0-9a-f-]{36}\/clinic\/[0-9a-f-]{36}\/patient-id$/iu.test(
              identifier.system ?? ""
            )
          )
        )
          semantic(
            issues,
            "FHIR_PATIENT_IDENTIFIER",
            "Patient requires the tenant/clinic-bound ClinicOS identifier namespace.",
            `${path}.identifier`
          );
        break;
      case "Practitioner":
        if (!hasIdentifierSystem(resource.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.practitioner))
          semantic(
            issues,
            "FHIR_PRACTITIONER_IDENTIFIER",
            "Practitioner requires the supported ClinicOS identifier namespace.",
            `${path}.identifier`
          );
        break;
      case "Provenance":
        if (!resource.target.length || !resource.agent.length || !validDateTime(resource.recorded))
          semantic(
            issues,
            "FHIR_PROVENANCE_REQUIRED_FIELDS",
            "Provenance requires target, agent and recorded instant.",
            path
          );
        if (
          !coding(
            resource.activity,
            CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM,
            "clinical-summary-export"
          )
        )
          semantic(
            issues,
            "FHIR_PROVENANCE_ACTIVITY",
            "Provenance.activity must identify clinical-summary-export.",
            `${path}.activity`
          );
        if (
          !resource.reason?.some((reason) =>
            coding(reason, CLINIC_OS_INTEROPERABILITY_PURPOSE_SYSTEM, "encounter-clinical-summary")
          ) ||
          !resource.policy?.includes(
            "https://fhir.clinicos.in/Policy/purpose-specific-interoperability-consent-v1"
          )
        )
          semantic(
            issues,
            "FHIR_PROVENANCE_PURPOSE",
            "Provenance must record the supported purpose and policy.",
            path
          );
        break;
      case "DocumentReference":
        if (
          !resource.content.length ||
          !resource.content.every((content) =>
            /^urn:clinicos:document-evidence:[0-9a-f-]{36}$/iu.test(content.attachment.url)
          )
        )
          semantic(
            issues,
            "FHIR_DOCUMENT_REFERENCE_URL",
            "DocumentReference content must use a mediated ClinicOS evidence URN; import never dereferences it.",
            `${path}.content`
          );
        if (
          resource.status !== "current" ||
          !(resource.docStatus === "final" || resource.docStatus === "amended") ||
          !coding(resource.type, "http://loinc.org", "11506-3") ||
          !resource.securityLabel?.some((label) =>
            coding(label, "http://terminology.hl7.org/CodeSystem/v3-Confidentiality", "R")
          ) ||
          !resource.content.every(
            (content) =>
              content.attachment.contentType === "application/fhir+json" &&
              validSha256Base64(content.attachment.hash)
          )
        )
          semantic(
            issues,
            "FHIR_DOCUMENT_REFERENCE_INVALID",
            "DocumentReference requires current signed-note evidence, restricted security and FHIR JSON content metadata.",
            path
          );
        break;
    }
  }
}

function validateDocumentGraph(
  resources: readonly FhirResource[],
  issues: ClinicOsFhirIssueInput[]
): void {
  const composition = resources.find((resource) => resource.resourceType === "Composition");
  const consent = resources.find((resource) => resource.resourceType === "Consent");
  const documentReference = resources.find(
    (resource) => resource.resourceType === "DocumentReference"
  );
  const encounter = resources.find((resource) => resource.resourceType === "Encounter");
  const patient = resources.find((resource) => resource.resourceType === "Patient");
  const practitioner = resources.find((resource) => resource.resourceType === "Practitioner");
  const provenance = resources.find((resource) => resource.resourceType === "Provenance");
  const medications = resources.filter((resource) => resource.resourceType === "MedicationRequest");
  const organizations = resources.filter((resource) => resource.resourceType === "Organization");
  const tenants = organizations.filter((organization) =>
    hasIdentifier(organization.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.tenant, organization.id)
  );
  const clinics = organizations.filter((organization) =>
    hasIdentifier(organization.identifier, CLINIC_OS_IDENTIFIER_SYSTEMS.clinic, organization.id)
  );
  const tenant = tenants[0];
  const clinic = clinics[0];
  if (
    !composition ||
    !consent ||
    !documentReference ||
    !encounter ||
    !patient ||
    !practitioner ||
    !provenance ||
    tenants.length !== 1 ||
    clinics.length !== 1 ||
    !tenant ||
    !clinic ||
    tenant.id === clinic.id
  ) {
    semantic(
      issues,
      "FHIR_DOCUMENT_GRAPH_IDENTITY",
      "The document graph requires distinct, exactly identified tenant and clinic organizations plus every supported singleton resource.",
      "Bundle.entry"
    );
    return;
  }

  const relationshipChecks = [
    referenceIs(clinic.partOf, "Organization", tenant.id),
    referenceIs(patient.managingOrganization, "Organization", clinic.id),
    referenceIs(encounter.subject, "Patient", patient.id),
    referenceIs(encounter.serviceProvider, "Organization", clinic.id),
    encounter.participant?.some((participant) =>
      referenceIs(participant.individual, "Practitioner", practitioner.id)
    ) === true,
    referenceIs(composition.subject, "Patient", patient.id),
    referenceIs(composition.encounter, "Encounter", encounter.id),
    referenceIs(composition.custodian, "Organization", clinic.id),
    composition.author.some((author) => referenceIs(author, "Practitioner", practitioner.id)),
    referenceIs(consent.patient, "Patient", patient.id),
    consent.organization?.some((organization) =>
      referenceIs(organization, "Organization", clinic.id)
    ) === true,
    consent.provision?.data?.some((data) =>
      referenceIs(data.reference, "Encounter", encounter.id)
    ) === true,
    referenceIs(documentReference.subject, "Patient", patient.id),
    documentReference.author?.some((author) =>
      referenceIs(author, "Practitioner", practitioner.id)
    ) === true,
    documentReference.context?.encounter?.some((item) =>
      referenceIs(item, "Encounter", encounter.id)
    ) === true,
    medications.every(
      (medication) =>
        referenceIs(medication.subject, "Patient", patient.id) &&
        referenceIs(medication.encounter, "Encounter", encounter.id) &&
        referenceIs(medication.requester, "Practitioner", practitioner.id)
    ),
    [documentReference, ...medications].every((clinicalEntry) =>
      composition.section.some((section) =>
        section.entry?.some((entry) =>
          referenceIs(entry, clinicalEntry.resourceType, clinicalEntry.id)
        )
      )
    ),
    [composition, encounter, documentReference, ...medications].every((target) =>
      provenance.target.some((reference) => referenceIs(reference, target.resourceType, target.id))
    ),
    provenance.agent.some(
      (agent) =>
        referenceIs(agent.who, "Practitioner", practitioner.id) &&
        referenceIs(agent.onBehalfOf, "Organization", clinic.id)
    ),
    provenance.entity?.some((entity) => entity.what.reference === `Consent/${consent.id}`) === true
  ];
  if (relationshipChecks.some((valid) => !valid)) {
    semantic(
      issues,
      "FHIR_DOCUMENT_GRAPH_SCOPE",
      "Composition, consent, evidence and clinical entries must all bind to the same patient, encounter, practitioner, clinic and tenant graph.",
      "Bundle.entry.resource.reference"
    );
  }
}

function referenceIs(
  reference: { readonly reference: string } | undefined,
  resourceType: FhirResource["resourceType"],
  id: string
): boolean {
  return reference?.reference === `${resourceType}/${id}`;
}

function validResourceShape(resource: Record<string, unknown>): boolean {
  if (!validMeta(resource.meta) || !validIdentifiers(resource.identifier)) return false;
  switch (resource.resourceType) {
    case "Composition":
      return (
        requiredString(resource.status) &&
        isCodeable(resource.type) &&
        isReference(resource.subject) &&
        optionalReference(resource.encounter) &&
        requiredString(resource.date) &&
        referenceArray(resource.author, true) &&
        requiredString(resource.title) &&
        isReference(resource.custodian) &&
        Array.isArray(resource.section) &&
        resource.section.length > 0 &&
        resource.section.every(validCompositionSection)
      );
    case "Consent":
      return (
        requiredString(resource.status) &&
        isCodeable(resource.scope) &&
        codeableArray(resource.category, true) &&
        optionalReference(resource.patient) &&
        optionalString(resource.dateTime) &&
        referenceArray(resource.performer) &&
        referenceArray(resource.organization) &&
        validConsentProvision(resource.provision)
      );
    case "DocumentReference":
      return (
        requiredString(resource.status) &&
        optionalString(resource.docStatus) &&
        optionalCodeable(resource.type) &&
        isReference(resource.subject) &&
        optionalString(resource.date) &&
        referenceArray(resource.author) &&
        optionalString(resource.description) &&
        codeableArray(resource.securityLabel) &&
        Array.isArray(resource.content) &&
        resource.content.length > 0 &&
        resource.content.every(validDocumentContent) &&
        validDocumentContext(resource.context) &&
        validRelatesTo(resource.relatesTo)
      );
    case "Encounter":
      return (
        requiredString(resource.status) &&
        isCoding(resource.class) &&
        isReference(resource.subject) &&
        validEncounterParticipants(resource.participant) &&
        validPeriod(resource.period) &&
        codeableArray(resource.reasonCode) &&
        optionalReference(resource.serviceProvider) &&
        referenceArray(resource.appointment)
      );
    case "MedicationRequest":
      return (
        requiredString(resource.status) &&
        requiredString(resource.intent) &&
        isCodeable(resource.medicationCodeableConcept) &&
        isReference(resource.subject) &&
        optionalReference(resource.encounter) &&
        optionalString(resource.authoredOn) &&
        optionalReference(resource.requester) &&
        textArray(resource.dosageInstruction) &&
        textArray(resource.note)
      );
    case "Organization":
      return (
        typeof resource.active === "boolean" &&
        requiredString(resource.name) &&
        optionalReference(resource.partOf)
      );
    case "Patient":
      return (
        typeof resource.active === "boolean" &&
        textArray(resource.name, true) &&
        optionalString(resource.gender) &&
        optionalString(resource.birthDate) &&
        optionalReference(resource.managingOrganization) &&
        validTelecom(resource.telecom)
      );
    case "Practitioner":
      return (
        typeof resource.active === "boolean" &&
        textArray(resource.name, true) &&
        validTelecom(resource.telecom)
      );
    case "Provenance":
      return (
        referenceArray(resource.target, true) &&
        optionalString(resource.occurredDateTime) &&
        requiredString(resource.recorded) &&
        stringArray(resource.policy) &&
        codeableArray(resource.reason) &&
        optionalCodeable(resource.activity) &&
        Array.isArray(resource.agent) &&
        resource.agent.length > 0 &&
        resource.agent.every(validProvenanceAgent) &&
        validProvenanceEntities(resource.entity)
      );
    default:
      return false;
  }
}

function validMeta(value: unknown): boolean {
  if (!isRecord(value) || !stringArray(value.profile, true)) return false;
  if (value.versionId !== undefined && !/^[1-9]\d{0,14}$/u.test(String(value.versionId)))
    return false;
  return (
    (value.lastUpdated === undefined || requiredString(value.lastUpdated)) &&
    (value.source === undefined || requiredString(value.source)) &&
    codingArray(value.security) &&
    codingArray(value.tag)
  );
}

function validIdentifiers(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (identifier) =>
          isRecord(identifier) &&
          requiredString(identifier.value) &&
          optionalString(identifier.system) &&
          optionalCodeable(identifier.type)
      ))
  );
}

function validCompositionSection(value: unknown): boolean {
  return (
    isRecord(value) &&
    requiredString(value.title) &&
    optionalCodeable(value.code) &&
    isRecord(value.text) &&
    requiredString(value.text.status) &&
    validNarrative(value.text.div) &&
    referenceArray(value.entry)
  );
}

function validNarrative(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    !value.startsWith('<div xmlns="http://www.w3.org/1999/xhtml">') ||
    !value.endsWith("</div>")
  )
    return false;
  const textOnly = value.replace(
    /<\/?(?:div(?: xmlns="http:\/\/www\.w3\.org\/1999\/xhtml")?|section|h2|p|ul|li)>/gu,
    ""
  );
  return !/[<>]/u.test(textOnly);
}

function validConsentProvision(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    optionalString(value.type) &&
    validPeriod(value.period) &&
    validPeriod(value.dataPeriod) &&
    codeableArray(value.action) &&
    codingArray(value.class) &&
    codingArray(value.purpose) &&
    (value.data === undefined ||
      (Array.isArray(value.data) &&
        value.data.every(
          (item) => isRecord(item) && requiredString(item.meaning) && isReference(item.reference)
        )))
  );
}

function validDocumentContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.attachment) &&
    requiredString(value.attachment.contentType) &&
    requiredString(value.attachment.title) &&
    requiredString(value.attachment.url) &&
    optionalString(value.attachment.hash) &&
    optionalString(value.attachment.creation)
  );
}

function validDocumentContext(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && referenceArray(value.encounter) && referenceArray(value.related))
  );
}

function validRelatesTo(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) => isRecord(item) && requiredString(item.code) && isReference(item.target)
      ))
  );
}

function validEncounterParticipants(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (participant) =>
          isRecord(participant) &&
          isReference(participant.individual) &&
          codeableArray(participant.type)
      ))
  );
}

function validPeriod(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && optionalString(value.start) && optionalString(value.end))
  );
}

function validTelecom(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          requiredString(item.system) &&
          requiredString(item.value) &&
          optionalString(item.use)
      ))
  );
}

function validProvenanceAgent(value: unknown): boolean {
  return (
    isRecord(value) &&
    codeableArray(value.role) &&
    isReference(value.who) &&
    optionalReference(value.onBehalfOf)
  );
}

function validProvenanceEntities(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (entity) =>
          isRecord(entity) &&
          requiredString(entity.role) &&
          isRecord(entity.what) &&
          optionalString(entity.what.display) &&
          (entity.what.identifier === undefined || validIdentifiers([entity.what.identifier])) &&
          optionalString(entity.what.reference)
      ))
  );
}

function isReference(value: unknown): boolean {
  return (
    isRecord(value) &&
    requiredString(value.reference) &&
    optionalString(value.display) &&
    optionalString(value.type)
  );
}

function optionalReference(value: unknown): boolean {
  return value === undefined || isReference(value);
}

function referenceArray(value: unknown, required = false): boolean {
  return value === undefined
    ? !required
    : Array.isArray(value) && (!required || value.length > 0) && value.every(isReference);
}

function isCoding(value: unknown): boolean {
  return (
    isRecord(value) &&
    requiredString(value.code) &&
    optionalString(value.system) &&
    optionalString(value.display)
  );
}

function codingArray(value: unknown, required = false): boolean {
  return value === undefined
    ? !required
    : Array.isArray(value) && (!required || value.length > 0) && value.every(isCoding);
}

function isCodeable(value: unknown): boolean {
  return (
    isRecord(value) &&
    codingArray(value.coding) &&
    optionalString(value.text) &&
    ((Array.isArray(value.coding) && value.coding.length > 0) || requiredString(value.text))
  );
}

function optionalCodeable(value: unknown): boolean {
  return value === undefined || isCodeable(value);
}

function codeableArray(value: unknown, required = false): boolean {
  return value === undefined
    ? !required
    : Array.isArray(value) && (!required || value.length > 0) && value.every(isCodeable);
}

function textArray(value: unknown, required = false): boolean {
  return value === undefined
    ? !required
    : Array.isArray(value) &&
        (!required || value.length > 0) &&
        value.every((item) => isRecord(item) && requiredString(item.text));
}

function stringArray(value: unknown, required = false): boolean {
  return value === undefined
    ? !required
    : Array.isArray(value) && (!required || value.length > 0) && value.every(requiredString);
}

function optionalString(value: unknown): boolean {
  return value === undefined || requiredString(value);
}

function validSha256Base64(value: unknown): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) return false;
  return Buffer.from(value, "base64").length === 32;
}

function validateResourceFieldAllowlist(
  resource: Record<string, unknown>,
  entryPath: string,
  issues: ClinicOsFhirIssueInput[]
): void {
  const resourceType = resource.resourceType as FhirResource["resourceType"];
  const allowed = RESOURCE_FIELDS[resourceType];
  for (const key of Object.keys(resource)) {
    if (!allowed.has(key)) {
      issues.push(
        issue(
          "FHIR_FIELD_NOT_ALLOWED",
          `Field ${key} is outside the ${resourceType} import allowlist.`,
          `${entryPath}.resource.${key}`,
          "not-supported"
        )
      );
    }
  }
}

function validateObjectFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ClinicOsFhirIssueInput[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(
        issue(
          "FHIR_FIELD_NOT_ALLOWED",
          `Field ${key} is outside the clinical-summary import allowlist.`,
          `${path}.${key}`,
          "not-supported"
        )
      );
    }
  }
}

function validateUriSurface(value: unknown, issues: ClinicOsFhirIssueInput[]): void {
  walk(value, "$", (nested, path, key) => {
    if (key && !IMPORT_FIELD_NAMES.has(key)) {
      issues.push(
        issue(
          "FHIR_FIELD_NOT_ALLOWED",
          `Field ${key} is outside the clinical-summary import allowlist.`,
          path,
          "not-supported"
        )
      );
    }
    if (FORBIDDEN_KEYS.has(key)) {
      issues.push(
        issue(
          "FHIR_EXTENSION_OR_CONTAINED_FORBIDDEN",
          `Field ${key} is not supported by this import boundary.`,
          path,
          "not-supported"
        )
      );
    }
    if (typeof nested !== "string") return;
    if (key === "profile") {
      if (
        !Object.values(CLINIC_OS_FHIR_R4_CORE_PROFILES).includes(nested as never) &&
        nested !== CLINIC_OS_CLINICAL_SUMMARY_PROFILE
      ) {
        issues.push(
          issue(
            "FHIR_PROFILE_NOT_ALLOWED",
            "An unrecognized profile URL is not allowed.",
            path,
            "not-supported"
          )
        );
      }
      return;
    }
    if (key === "system") {
      if (!allowedSystem(nested)) {
        issues.push(
          issue(
            "FHIR_SYSTEM_NOT_ALLOWED",
            "An unrecognized identifier or terminology system is not allowed.",
            path,
            "not-supported"
          )
        );
      }
      return;
    }
    if (key === "policy") {
      if (
        nested !== "https://fhir.clinicos.in/Policy/purpose-specific-interoperability-consent-v1"
      ) {
        issues.push(
          issue(
            "FHIR_POLICY_NOT_ALLOWED",
            "An unrecognized provenance policy is not allowed.",
            path,
            "not-supported"
          )
        );
      }
      return;
    }
    if (key === "fullUrl" && /^urn:uuid:[0-9a-f-]{36}$/iu.test(nested)) return;
    if (key === "reference" && /^urn:uuid:[0-9a-f-]{36}$/iu.test(nested)) return;
    if (key === "url" && /^urn:clinicos:document-evidence:[0-9a-f-]{36}$/iu.test(nested)) return;
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(nested)) return;
    issues.push(
      issue(
        "FHIR_URL_FORBIDDEN",
        "Arbitrary URLs are not accepted or dereferenced by the clinical-summary import boundary.",
        path,
        "forbidden"
      )
    );
  });
}

function allowedSystem(value: string): boolean {
  return (
    ALLOWED_SYSTEMS.has(value) ||
    /^https:\/\/fhir\.clinicos\.in\/NamingSystem\/tenant\/[0-9a-f-]{36}\/clinic\/[0-9a-f-]{36}\/patient-id$/iu.test(
      value
    )
  );
}

function scanBounds(value: unknown, bounds: ClinicalSummaryImportBounds): void {
  let strings = 0;
  let keys = 0;
  const visit = (nested: unknown, depth: number, path: string): void => {
    if (depth > bounds.maxDepth)
      throw validationError(
        [
          issue(
            "FHIR_DEPTH_LIMIT_EXCEEDED",
            `FHIR document exceeds the ${bounds.maxDepth} nesting-depth limit.`,
            path,
            "too-costly"
          )
        ],
        413
      );
    if (typeof nested === "string") {
      strings += 1;
      if (strings > bounds.maxStrings || nested.length > bounds.maxStringLength)
        throw validationError(
          [
            issue(
              "FHIR_STRING_LIMIT_EXCEEDED",
              "FHIR document string count or length exceeds the configured limit.",
              path,
              "too-costly"
            )
          ],
          413
        );
      return;
    }
    if (!nested || typeof nested !== "object") return;
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(nested)) {
      keys += 1;
      if (keys > bounds.maxObjectKeys)
        throw validationError(
          [
            issue(
              "FHIR_OBJECT_KEY_LIMIT_EXCEEDED",
              "FHIR document object-key count exceeds the configured limit.",
              path,
              "too-costly"
            )
          ],
          413
        );
      visit(item, depth + 1, `${path}.${key}`);
    }
  };
  visit(value, 0, "$");
}

function collectReferences(
  value: unknown,
  path: string,
  references: Array<{ path: string; reference: string }>
): void {
  if (!value || typeof value !== "object") return;
  if (isRecord(value) && typeof value.reference === "string")
    references.push({ path: `${path}.reference`, reference: value.reference });
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, `${path}[${index}]`, references));
    return;
  }
  for (const [key, nested] of Object.entries(value))
    collectReferences(nested, `${path}.${key}`, references);
}

function walk(
  value: unknown,
  path: string,
  visitor: (value: unknown, path: string, key: string) => void,
  key = ""
): void {
  visitor(value, path, key);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visitor, key));
    return;
  }
  for (const [nestedKey, nested] of Object.entries(value))
    walk(nested, `${path}.${nestedKey}`, visitor, nestedKey);
}

function supportedResourceType(value: unknown): value is FhirResource["resourceType"] {
  return (
    typeof value === "string" &&
    (CLINIC_OS_SUPPORTED_DOCUMENT_RESOURCE_TYPES as readonly string[]).includes(value)
  );
}

function profileIncludes(meta: unknown, profile: string): boolean {
  return isRecord(meta) && Array.isArray(meta.profile) && meta.profile.includes(profile);
}

function coding(value: unknown, system: string, code: string): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.coding) &&
    value.coding.some((item) => isRecord(item) && item.system === system && item.code === code)
  );
}

function hasIdentifier(
  identifiers: readonly FhirIdentifier[] | undefined,
  system: string,
  value: string
): boolean {
  return Boolean(
    identifiers?.some((identifier) => identifier.system === system && identifier.value === value)
  );
}

function hasIdentifierSystem(
  identifiers: readonly FhirIdentifier[] | undefined,
  system: string
): boolean {
  return Boolean(identifiers?.some((identifier) => identifier.system === system));
}

function issue(
  clinicOsCode: string,
  diagnostics: string,
  expression: string,
  code: ClinicOsFhirIssueInput["code"]
): ClinicOsFhirIssueInput {
  return { clinicOsCode, diagnostics, expression: [expression], code };
}

function semantic(
  issues: ClinicOsFhirIssueInput[],
  clinicOsCode: string,
  diagnostics: string,
  expression: string
): void {
  issues.push(issue(clinicOsCode, diagnostics, expression, "business-rule"));
}

function invalid(
  issues: readonly ClinicOsFhirIssueInput[]
): ClinicalSummaryDocumentValidationResult {
  return {
    bundle: null,
    valid: false,
    outcome: {
      resourceType: "OperationOutcome",
      issue: issues.map((item) => ({
        severity: item.severity ?? "error",
        code: item.code,
        diagnostics: item.diagnostics,
        expression: item.expression ? [...item.expression] : undefined,
        details: {
          coding: [
            {
              system: "https://fhir.clinicos.in/CodeSystem/interoperability-issue",
              code: item.clinicOsCode
            }
          ],
          text: item.diagnostics
        }
      }))
    }
  };
}

function fromIssue(value: FhirOperationOutcome["issue"][number]): ClinicOsFhirIssueInput {
  return {
    code: value.code,
    diagnostics: value.diagnostics ?? value.details?.text ?? "FHIR document validation failed.",
    expression: value.expression,
    clinicOsCode: value.details?.coding?.[0]?.code ?? "FHIR_VALIDATION_FAILED",
    severity: value.severity
  };
}

function validationError(
  issues: readonly ClinicOsFhirIssueInput[],
  httpStatus: number
): ClinicOsFhirError {
  return new ClinicOsFhirError({ httpStatus, issues });
}

function fields(...values: string[]): ReadonlySet<string> {
  return new Set(values);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertBounds(bounds: ClinicalSummaryImportBounds): void {
  for (const [key, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${key} must be a positive safe integer.`);
  }
}
