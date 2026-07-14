import type { FhirCapabilityStatement, FhirResource } from "./types.ts";

export const CLINIC_OS_FHIR_R4_VERSION = "4.0.1" as const;
export const CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION = "1.0.0" as const;
export const CLINIC_OS_CLINICAL_SUMMARY_PROFILE = "http://hl7.org/fhir/StructureDefinition/Bundle";

export const CLINIC_OS_FHIR_R4_CORE_PROFILES = Object.freeze({
  Composition: "http://hl7.org/fhir/StructureDefinition/Composition",
  Consent: "http://hl7.org/fhir/StructureDefinition/Consent",
  DocumentReference: "http://hl7.org/fhir/StructureDefinition/DocumentReference",
  Encounter: "http://hl7.org/fhir/StructureDefinition/Encounter",
  MedicationRequest: "http://hl7.org/fhir/StructureDefinition/MedicationRequest",
  Organization: "http://hl7.org/fhir/StructureDefinition/Organization",
  Patient: "http://hl7.org/fhir/StructureDefinition/Patient",
  Practitioner: "http://hl7.org/fhir/StructureDefinition/Practitioner",
  Provenance: "http://hl7.org/fhir/StructureDefinition/Provenance"
} satisfies Readonly<Record<FhirResource["resourceType"], string>>);

export const CLINIC_OS_SUPPORTED_DOCUMENT_RESOURCE_TYPES = Object.freeze(
  Object.keys(CLINIC_OS_FHIR_R4_CORE_PROFILES) as FhirResource["resourceType"][]
);

const CAPABILITY: FhirCapabilityStatement = {
  resourceType: "CapabilityStatement",
  id: "clinic-os-fhir-r4-clinical-summary-1",
  url: "https://fhir.clinicos.in/CapabilityStatement/clinical-summary",
  version: CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION,
  name: "ClinicOsFhirR4ClinicalSummaryCapability",
  title: "ClinicOS FHIR R4 Clinical Summary Document Capability",
  status: "active",
  experimental: false,
  date: "2026-07-14",
  publisher: "ClinicOS",
  kind: "capability",
  software: {
    name: "ClinicOS interoperability module",
    version: CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION
  },
  fhirVersion: CLINIC_OS_FHIR_R4_VERSION,
  format: ["application/fhir+json"],
  document: [
    {
      mode: "producer",
      profile: CLINIC_OS_CLINICAL_SUMMARY_PROFILE,
      documentation:
        "Produces a closed FHIR R4 document Bundle for one authorized patient encounter."
    },
    {
      mode: "consumer",
      profile: CLINIC_OS_CLINICAL_SUMMARY_PROFILE,
      documentation:
        "Consumes the allowlisted closed document into a manual, versioned reconciliation queue; it never auto-merges patients."
    }
  ],
  rest: [
    {
      mode: "server",
      documentation:
        "Transport-neutral capability. Authentication, tenant scope, purpose-specific consent, idempotency and conditional versions are mandatory at the registered ClinicOS API boundary.",
      security: {
        cors: false,
        description:
          "ClinicOS bearer/session authentication and explicit interoperability capabilities are required. No anonymous exchange is supported.",
        service: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/restful-security-service",
                code: "OAuth"
              }
            ],
            text: "OAuth-compatible ClinicOS authenticated boundary"
          }
        ]
      },
      resource: CLINIC_OS_SUPPORTED_DOCUMENT_RESOURCE_TYPES.map((type) => ({
        type,
        profile: CLINIC_OS_FHIR_R4_CORE_PROFILES[type],
        supportedProfile: [CLINIC_OS_FHIR_R4_CORE_PROFILES[type]],
        referencePolicy: ["enforced", "local"],
        versioning: "versioned-update"
      }))
    }
  ]
};

export function clinicOsFhirR4CapabilityStatement(): FhirCapabilityStatement {
  return structuredClone(CAPABILITY);
}
