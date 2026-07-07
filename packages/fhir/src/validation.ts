import type { FhirBundle, FhirBundleEntry, FhirResource } from "./types.ts";

export interface ClinicOsFhirValidationOptions {
  allowExternalReferences?: boolean;
  forbiddenSerializedSubstrings?: string[];
  requiredResourceTypes?: string[];
  requireMetaProfile?: boolean;
}

export interface ClinicOsFhirValidationResult {
  errors: string[];
  summary: {
    bundleId: string;
    entries: number;
    resourceCounts: Record<string, number>;
  };
  valid: boolean;
  warnings: string[];
}

const FHIR_ID_PATTERN = /^[A-Za-z0-9\-.]{1,64}$/;
const DEFAULT_REQUIRED_RESOURCE_TYPES = ["Patient", "Encounter", "DocumentReference"];
const DEFAULT_FORBIDDEN_SERIALIZED_SUBSTRINGS = [
  '"objectKey"',
  '"rawStoragePath"',
  '"storageProvider"',
  "s3://",
  "file://",
  "/tenants/",
  "private-media"
];

export function assertClinicOsFhirBundle(
  bundle: FhirBundle,
  options: ClinicOsFhirValidationOptions = {}
): void {
  const result = validateClinicOsFhirBundle(bundle, options);
  if (!result.valid) {
    throw new Error(`FHIR bundle validation failed:\n${result.errors.join("\n")}`);
  }
}

export function validateClinicOsFhirBundle(
  bundle: FhirBundle,
  options: ClinicOsFhirValidationOptions = {}
): ClinicOsFhirValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resourceCounts: Record<string, number> = {};
  const requireMetaProfile = options.requireMetaProfile ?? true;
  const requiredResourceTypes = options.requiredResourceTypes ?? DEFAULT_REQUIRED_RESOURCE_TYPES;
  const forbiddenSerializedSubstrings =
    options.forbiddenSerializedSubstrings ?? DEFAULT_FORBIDDEN_SERIALIZED_SUBSTRINGS;

  if (bundle.resourceType !== "Bundle") errors.push("Bundle.resourceType must be Bundle.");
  if (!FHIR_ID_PATTERN.test(bundle.id)) errors.push(`Bundle.id is not a FHIR id: ${bundle.id}`);
  if (!["collection", "document"].includes(bundle.type)) {
    errors.push(`Bundle.type must be collection or document, got ${bundle.type}.`);
  }
  if (!Array.isArray(bundle.entry) || bundle.entry.length === 0) {
    errors.push("Bundle.entry must contain at least one resource.");
  }
  if (requireMetaProfile && !hasProfile(bundle.meta)) {
    errors.push("Bundle.meta.profile is required for ClinicOS exchange bundles.");
  }

  const resourceKeys = new Set<string>();
  const fullUrls = new Set<string>();
  const references: Array<{ path: string; reference: string }> = [];

  for (const [index, entry] of (bundle.entry ?? []).entries()) {
    validateEntry(entry, index, errors, resourceKeys, fullUrls, resourceCounts, requireMetaProfile);
    collectReferences(entry.resource, `entry[${index}].resource`, references);
  }

  for (const requiredType of requiredResourceTypes) {
    if (!resourceCounts[requiredType]) {
      errors.push(`Bundle must include at least one ${requiredType} resource.`);
    }
  }

  validateReferences(
    references,
    resourceKeys,
    fullUrls,
    errors,
    options.allowExternalReferences ?? false
  );
  validateProfileishInvariants(bundle.entry ?? [], errors);
  assertNoForbiddenSerializedSubstrings(bundle, forbiddenSerializedSubstrings, errors);

  return {
    errors,
    summary: {
      bundleId: bundle.id,
      entries: bundle.entry?.length ?? 0,
      resourceCounts
    },
    valid: errors.length === 0,
    warnings
  };
}

function validateEntry(
  entry: FhirBundleEntry,
  index: number,
  errors: string[],
  resourceKeys: Set<string>,
  fullUrls: Set<string>,
  resourceCounts: Record<string, number>,
  requireMetaProfile: boolean
): void {
  if (!entry.fullUrl) errors.push(`Bundle.entry[${index}].fullUrl is required.`);
  if (entry.fullUrl && fullUrls.has(entry.fullUrl)) {
    errors.push(`Duplicate Bundle.entry.fullUrl ${entry.fullUrl}.`);
  }
  if (entry.fullUrl) fullUrls.add(entry.fullUrl);
  if (!entry.resource) {
    errors.push(`Bundle.entry[${index}].resource is required.`);
    return;
  }

  const resource = entry.resource;
  const key = `${resource.resourceType}/${resource.id}`;
  resourceCounts[resource.resourceType] = (resourceCounts[resource.resourceType] ?? 0) + 1;

  if (!FHIR_ID_PATTERN.test(resource.id)) {
    errors.push(`${key} id is not a valid FHIR id.`);
  }
  if (resourceKeys.has(key)) errors.push(`Duplicate resource id ${key}.`);
  resourceKeys.add(key);
  if (entry.fullUrl && entry.fullUrl !== `urn:uuid:${resource.id}`) {
    errors.push(`${key} fullUrl must be urn:uuid:${resource.id}.`);
  }
  if (requireMetaProfile && !hasProfile(resource.meta)) {
    errors.push(`${key} meta.profile is required.`);
  }
}

function collectReferences(
  value: unknown,
  path: string,
  references: Array<{ path: string; reference: string }>
): void {
  if (!value || typeof value !== "object") return;

  if ("reference" in value && typeof value.reference === "string") {
    references.push({ path: `${path}.reference`, reference: value.reference });
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      collectReferences(item, `${path}[${index}]`, references);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    collectReferences(nested, `${path}.${key}`, references);
  }
}

function validateReferences(
  references: Array<{ path: string; reference: string }>,
  resourceKeys: ReadonlySet<string>,
  fullUrls: ReadonlySet<string>,
  errors: string[],
  allowExternalReferences: boolean
): void {
  for (const { path, reference } of references) {
    if (reference.startsWith("#")) continue;
    if (reference.startsWith("urn:uuid:")) {
      if (!fullUrls.has(reference)) errors.push(`${path} references missing ${reference}.`);
      continue;
    }
    if (/^[A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/.test(reference)) {
      if (!resourceKeys.has(reference)) errors.push(`${path} references missing ${reference}.`);
      continue;
    }
    if (!allowExternalReferences) {
      errors.push(`${path} uses external or unsupported reference ${reference}.`);
    }
  }
}

function validateProfileishInvariants(entries: FhirBundleEntry[], errors: string[]): void {
  for (const { resource } of entries) {
    switch (resource.resourceType) {
      case "Patient":
        if (!resource.identifier?.length)
          errors.push(`Patient/${resource.id} requires identifier.`);
        if (!resource.name?.length) errors.push(`Patient/${resource.id} requires name.`);
        break;
      case "Encounter":
        if (!resource.subject?.reference?.startsWith("Patient/")) {
          errors.push(`Encounter/${resource.id} subject must reference Patient.`);
        }
        break;
      case "DocumentReference":
        if (!resource.subject?.reference?.startsWith("Patient/")) {
          errors.push(`DocumentReference/${resource.id} subject must reference Patient.`);
        }
        if (!resource.content?.length) {
          errors.push(`DocumentReference/${resource.id} must include content.`);
        }
        for (const [index, content] of (resource.content ?? []).entries()) {
          const attachment = content.attachment;
          if (!attachment?.contentType) {
            errors.push(
              `DocumentReference/${resource.id}.content[${index}] requires attachment.contentType.`
            );
          }
          if (!attachment?.url?.startsWith("urn:clinicos:")) {
            errors.push(
              `DocumentReference/${resource.id}.content[${index}] must use a mediated urn:clinicos URL.`
            );
          }
        }
        break;
      case "Composition":
        if (!resource.subject?.reference?.startsWith("Patient/")) {
          errors.push(`Composition/${resource.id} subject must reference Patient.`);
        }
        if (!resource.author?.length) errors.push(`Composition/${resource.id} requires author.`);
        break;
      case "Provenance":
        if (!resource.target?.length) errors.push(`Provenance/${resource.id} requires target.`);
        if (!resource.agent?.length) errors.push(`Provenance/${resource.id} requires agent.`);
        break;
    }
  }
}

function assertNoForbiddenSerializedSubstrings(
  bundle: FhirBundle,
  forbiddenSubstrings: readonly string[],
  errors: string[]
): void {
  const serialized = JSON.stringify(bundle);
  for (const forbidden of forbiddenSubstrings) {
    if (serialized.includes(forbidden)) {
      errors.push(`Bundle exposes forbidden storage/privacy marker: ${forbidden}.`);
    }
  }
}

function hasProfile(meta: { profile?: string[] } | undefined): boolean {
  return Array.isArray(meta?.profile) && meta.profile.length > 0;
}
