import type {
  FhirBundle,
  FhirCodeableConcept,
  FhirComposition,
  FhirDocumentReference,
  FhirEncounter,
  FhirOrganization,
  FhirPatient,
  FhirPractitioner,
  FhirProvenance,
  FhirReference,
  FhirResource
} from "./types.ts";

export const CLINIC_OS_FHIR_PROFILES = {
  bundle: "https://clinicos.local/fhir/StructureDefinition/clinic-os-exchange-bundle",
  clinicalNoteComposition:
    "https://clinicos.local/fhir/StructureDefinition/clinic-os-clinical-note-composition",
  documentReference: "https://clinicos.local/fhir/StructureDefinition/clinic-os-document-reference",
  encounter: "https://clinicos.local/fhir/StructureDefinition/clinic-os-encounter",
  organization: "https://clinicos.local/fhir/StructureDefinition/clinic-os-organization",
  patient: "https://clinicos.local/fhir/StructureDefinition/clinic-os-patient",
  practitioner: "https://clinicos.local/fhir/StructureDefinition/clinic-os-practitioner",
  provenance: "https://clinicos.local/fhir/StructureDefinition/clinic-os-provenance"
} as const;

const CLINIC_OS_NAMING_SYSTEMS = {
  clinic: "https://clinicos.local/fhir/NamingSystem/clinic-os-clinic-id",
  encounter: "https://clinicos.local/fhir/NamingSystem/clinic-os-encounter-id",
  externalPatient: "https://clinicos.local/fhir/NamingSystem/clinic-os-external-patient-id",
  hfr: "https://nrces.in/ndhm/fhir/r4/CodeSystem/hfr-id",
  hpr: "https://nrces.in/ndhm/fhir/r4/CodeSystem/hpr-id",
  patient: "https://clinicos.local/fhir/NamingSystem/clinic-os-patient-id",
  practitioner: "https://clinicos.local/fhir/NamingSystem/clinic-os-practitioner-id"
} as const;

export interface ClinicOsFhirTenant {
  id: string;
  displayName: string;
}

export interface ClinicOsFhirClinic {
  id: string;
  tenantId: string;
  displayName: string;
  hfrId?: string | null;
  timezone: string;
}

export interface ClinicOsFhirPatient {
  id: string;
  tenantId: string;
  clinicId: string;
  abhaAddress?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  externalId?: string | null;
  fullName: string;
  gender?: "female" | "male" | "other" | "unknown" | null;
  phone?: string | null;
}

export interface ClinicOsFhirPractitioner {
  id: string;
  displayName: string;
  email?: string | null;
  hprId?: string | null;
  phone?: string | null;
  roleSlug?: string | null;
}

export interface ClinicOsFhirEncounter {
  id: string;
  tenantId: string;
  clinicId: string;
  appointmentId?: string | null;
  closedAt?: string | null;
  patientId: string;
  providerUserId: string;
  reason?: string | null;
  startedAt?: string | null;
  status: string;
}

export type ClinicOsDocumentEvidenceKind = "clinical_note" | "diagnostic_report" | "media_document";
export type ClinicOsDocumentEvidenceStatus = "amended" | "draft" | "final";

export interface ClinicOsDocumentEvidence {
  id: string;
  kind: ClinicOsDocumentEvidenceKind;
  patientId: string;
  authorUserId?: string | null;
  contentSections?: Record<string, string>;
  contentType: string;
  createdAt: string;
  description?: string | null;
  encounterId?: string | null;
  signedAt?: string | null;
  signedHash?: string | null;
  sourceReference?: string | null;
  status: ClinicOsDocumentEvidenceStatus;
  title: string;
  uri?: string | null;
}

export interface ClinicOsFhirProjectionInput {
  bundleId: string;
  clinic: ClinicOsFhirClinic;
  documents: ClinicOsDocumentEvidence[];
  encounter: ClinicOsFhirEncounter;
  generatedAt: string;
  patient: ClinicOsFhirPatient;
  practitioners: ClinicOsFhirPractitioner[];
  tenant: ClinicOsFhirTenant;
}

export function buildClinicOsPatientEncounterDocumentBundle(
  input: ClinicOsFhirProjectionInput
): FhirBundle {
  const practitionerById = new Map(
    input.practitioners.map((practitioner) => [practitioner.id, practitioner])
  );
  const organization = buildOrganization(input.clinic);
  const patient = buildPatient(input.patient, input.clinic);
  const practitioners = input.practitioners.map(buildPractitioner);
  const encounter = buildEncounter(input.encounter, input.patient, input.clinic, practitionerById);
  const documentResources = input.documents.flatMap((document) =>
    buildDocumentEvidenceResources(document, practitionerById)
  );

  const resources: FhirResource[] = [
    organization,
    patient,
    ...practitioners,
    encounter,
    ...documentResources
  ];

  return {
    resourceType: "Bundle",
    id: input.bundleId,
    meta: {
      profile: [CLINIC_OS_FHIR_PROFILES.bundle],
      tag: [
        {
          system: "https://clinicos.local/fhir/CodeSystem/exchange-boundary",
          code: "projection",
          display: "ClinicOS domain projection"
        }
      ]
    },
    timestamp: input.generatedAt,
    type: "collection",
    entry: resources.map((resource) => ({
      fullUrl: `urn:uuid:${resource.id}`,
      resource
    }))
  };
}

function buildOrganization(clinic: ClinicOsFhirClinic): FhirOrganization {
  return {
    resourceType: "Organization",
    id: clinic.id,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.organization] },
    active: true,
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/source-of-truth",
        valueCode: "clinic-os"
      },
      {
        url: "https://clinicos.local/fhir/StructureDefinition/clinic-timezone",
        valueString: clinic.timezone
      }
    ],
    identifier: [
      { system: CLINIC_OS_NAMING_SYSTEMS.clinic, value: clinic.id },
      ...(clinic.hfrId ? [{ system: CLINIC_OS_NAMING_SYSTEMS.hfr, value: clinic.hfrId }] : [])
    ],
    name: clinic.displayName
  };
}

function buildPatient(patient: ClinicOsFhirPatient, clinic: ClinicOsFhirClinic): FhirPatient {
  const identifiers = [
    { system: CLINIC_OS_NAMING_SYSTEMS.patient, value: patient.id },
    ...(patient.externalId
      ? [{ system: CLINIC_OS_NAMING_SYSTEMS.externalPatient, value: patient.externalId }]
      : [])
  ];

  return {
    resourceType: "Patient",
    id: patient.id,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.patient] },
    active: true,
    ...(patient.dateOfBirth ? { birthDate: patient.dateOfBirth } : {}),
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/source-of-truth",
        valueCode: "clinic-os"
      },
      {
        url: "https://clinicos.local/fhir/StructureDefinition/abha-link-state",
        valueCode: patient.abhaAddress ? "abha_address_recorded" : "not_recorded"
      }
    ],
    gender: patient.gender ?? "unknown",
    identifier: identifiers,
    managingOrganization: reference("Organization", clinic.id, clinic.displayName),
    name: [{ text: patient.fullName }],
    telecom: [
      ...(patient.phone
        ? [{ system: "phone" as const, value: patient.phone, use: "mobile" as const }]
        : []),
      ...(patient.email
        ? [{ system: "email" as const, value: patient.email, use: "home" as const }]
        : [])
    ]
  };
}

function buildPractitioner(practitioner: ClinicOsFhirPractitioner): FhirPractitioner {
  return {
    resourceType: "Practitioner",
    id: practitioner.id,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.practitioner] },
    active: true,
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/clinic-role",
        valueString: practitioner.roleSlug ?? "unknown"
      }
    ],
    identifier: [
      { system: CLINIC_OS_NAMING_SYSTEMS.practitioner, value: practitioner.id },
      ...(practitioner.hprId
        ? [{ system: CLINIC_OS_NAMING_SYSTEMS.hpr, value: practitioner.hprId }]
        : [])
    ],
    name: [{ text: practitioner.displayName }],
    telecom: [
      ...(practitioner.phone
        ? [{ system: "phone" as const, value: practitioner.phone, use: "mobile" as const }]
        : []),
      ...(practitioner.email
        ? [{ system: "email" as const, value: practitioner.email, use: "work" as const }]
        : [])
    ]
  };
}

function buildEncounter(
  encounter: ClinicOsFhirEncounter,
  patient: ClinicOsFhirPatient,
  clinic: ClinicOsFhirClinic,
  practitionerById: ReadonlyMap<string, ClinicOsFhirPractitioner>
): FhirEncounter {
  const practitioner = practitionerById.get(encounter.providerUserId);
  return {
    resourceType: "Encounter",
    id: encounter.id,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.encounter] },
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory"
    },
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/source-of-truth",
        valueCode: "clinic-os"
      },
      {
        url: "https://clinicos.local/fhir/StructureDefinition/clinic-os-encounter-status",
        valueCode: encounter.status
      },
      ...(encounter.appointmentId
        ? [
            {
              url: "https://clinicos.local/fhir/StructureDefinition/source-appointment-id",
              valueString: encounter.appointmentId
            }
          ]
        : [])
    ],
    identifier: [{ system: CLINIC_OS_NAMING_SYSTEMS.encounter, value: encounter.id }],
    participant: practitioner
      ? [
          {
            individual: reference("Practitioner", practitioner.id, practitioner.displayName),
            type: [
              {
                coding: [
                  {
                    system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                    code: "PPRF",
                    display: "primary performer"
                  }
                ]
              }
            ]
          }
        ]
      : undefined,
    period:
      encounter.startedAt || encounter.closedAt
        ? {
            ...(encounter.startedAt ? { start: encounter.startedAt } : {}),
            ...(encounter.closedAt ? { end: encounter.closedAt } : {})
          }
        : undefined,
    reasonCode: encounter.reason ? [{ text: encounter.reason }] : undefined,
    serviceProvider: reference("Organization", clinic.id, clinic.displayName),
    status: mapEncounterStatus(encounter.status),
    subject: reference("Patient", patient.id, patient.fullName)
  };
}

function buildDocumentEvidenceResources(
  document: ClinicOsDocumentEvidence,
  practitionerById: ReadonlyMap<string, ClinicOsFhirPractitioner>
): FhirResource[] {
  const author = document.authorUserId ? practitionerById.get(document.authorUserId) : undefined;
  const composition =
    document.kind === "clinical_note" ? buildComposition(document, author) : undefined;
  const documentReference = buildDocumentReference(document, author, composition);
  const provenance = buildProvenance(document, author, composition, documentReference);

  return composition
    ? [composition, documentReference, provenance]
    : [documentReference, provenance];
}

function buildComposition(
  document: ClinicOsDocumentEvidence,
  author: ClinicOsFhirPractitioner | undefined
): FhirComposition {
  return {
    resourceType: "Composition",
    id: `${document.id}-composition`,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.clinicalNoteComposition] },
    author: [
      author
        ? reference("Practitioner", author.id, author.displayName)
        : reference("Practitioner", "unknown", "Unknown author")
    ],
    date: document.signedAt ?? document.createdAt,
    encounter: document.encounterId ? reference("Encounter", document.encounterId) : undefined,
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/source-of-truth",
        valueCode: "clinic-os"
      },
      ...(document.signedHash
        ? [
            {
              url: "https://clinicos.local/fhir/StructureDefinition/signed-content-hash",
              valueString: document.signedHash
            }
          ]
        : [])
    ],
    section: Object.entries(document.contentSections ?? {}).map(([key, value]) => ({
      code: codeable(
        "https://clinicos.local/fhir/CodeSystem/clinical-note-section",
        key,
        titleFromKey(key)
      ),
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(value)}</div>`
      },
      title: titleFromKey(key)
    })),
    status: mapCompositionStatus(document.status),
    subject: reference("Patient", document.patientId),
    title: document.title,
    type: codeable("http://loinc.org", "11506-3", "Progress note")
  };
}

function buildDocumentReference(
  document: ClinicOsDocumentEvidence,
  author: ClinicOsFhirPractitioner | undefined,
  composition: FhirComposition | undefined
): FhirDocumentReference {
  const documentReference: FhirDocumentReference = {
    resourceType: "DocumentReference",
    id: document.id,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.documentReference] },
    author: author ? [reference("Practitioner", author.id, author.displayName)] : undefined,
    content: [
      {
        attachment: {
          contentType: document.contentType,
          creation: document.signedAt ?? document.createdAt,
          title: document.title,
          url: document.uri ?? `urn:clinicos:document-evidence:${document.id}`
        }
      }
    ],
    context: {
      ...(document.encounterId
        ? { encounter: [reference("Encounter", document.encounterId)] }
        : {}),
      ...(composition
        ? { related: [reference("Composition", composition.id, document.title)] }
        : {})
    },
    date: document.signedAt ?? document.createdAt,
    description: document.description ?? undefined,
    docStatus: mapDocumentStatus(document.status),
    extension: [
      {
        url: "https://clinicos.local/fhir/StructureDefinition/source-of-truth",
        valueCode: "clinic-os"
      },
      {
        url: "https://clinicos.local/fhir/StructureDefinition/document-evidence-kind",
        valueCode: document.kind
      },
      ...(document.signedHash
        ? [
            {
              url: "https://clinicos.local/fhir/StructureDefinition/signed-content-hash",
              valueString: document.signedHash
            }
          ]
        : [])
    ],
    relatesTo: composition
      ? [
          {
            code: "transforms",
            target: reference("Composition", composition.id, document.title)
          }
        ]
      : undefined,
    securityLabel: [
      codeable("http://terminology.hl7.org/CodeSystem/v3-Confidentiality", "R", "restricted")
    ],
    status: document.status === "draft" ? "current" : "current",
    subject: reference("Patient", document.patientId),
    type:
      document.kind === "clinical_note"
        ? codeable("http://loinc.org", "11506-3", "Progress note")
        : codeable(
            "https://clinicos.local/fhir/CodeSystem/document-kind",
            document.kind,
            titleFromKey(document.kind)
          )
  };

  return documentReference;
}

function buildProvenance(
  document: ClinicOsDocumentEvidence,
  author: ClinicOsFhirPractitioner | undefined,
  composition: FhirComposition | undefined,
  documentReference: FhirDocumentReference
): FhirProvenance {
  return {
    resourceType: "Provenance",
    id: `${document.id}-provenance`,
    meta: { profile: [CLINIC_OS_FHIR_PROFILES.provenance] },
    agent: [
      {
        role: [
          codeable("http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "AUT", "author")
        ],
        who: author
          ? reference("Practitioner", author.id, author.displayName)
          : reference("Practitioner", "unknown", "Unknown author")
      }
    ],
    entity: [
      {
        role: "source",
        what: {
          display: document.sourceReference ?? "ClinicOS domain evidence",
          ...(document.signedHash
            ? {
                identifier: {
                  system: "https://clinicos.local/fhir/NamingSystem/signed-content-hash",
                  value: document.signedHash
                }
              }
            : {})
        }
      }
    ],
    recorded: document.signedAt ?? document.createdAt,
    target: [
      reference("DocumentReference", documentReference.id, document.title),
      ...(composition ? [reference("Composition", composition.id, document.title)] : [])
    ]
  };
}

function mapEncounterStatus(status: string): FhirEncounter["status"] {
  switch (status) {
    case "cancelled":
      return "cancelled";
    case "scheduled":
      return "planned";
    case "closed":
    case "completed":
    case "signed":
    case "amended":
      return "finished";
    case "drafting":
    case "encounter_started":
    case "in_consult":
    case "ready_for_sign":
    case "charting":
      return "in-progress";
    default:
      return "unknown";
  }
}

function mapCompositionStatus(status: ClinicOsDocumentEvidenceStatus): FhirComposition["status"] {
  switch (status) {
    case "amended":
      return "amended";
    case "draft":
      return "preliminary";
    case "final":
      return "final";
  }
}

function mapDocumentStatus(
  status: ClinicOsDocumentEvidenceStatus
): FhirDocumentReference["docStatus"] {
  switch (status) {
    case "amended":
      return "amended";
    case "draft":
      return "preliminary";
    case "final":
      return "final";
  }
}

function codeable(system: string, code: string, display: string): FhirCodeableConcept {
  return {
    coding: [{ system, code, display }],
    text: display
  };
}

function reference(resourceType: string, id: string, display?: string): FhirReference {
  return {
    reference: `${resourceType}/${id}`,
    ...(display ? { display } : {})
  };
}

function titleFromKey(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
