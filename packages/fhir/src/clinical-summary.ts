import { createHash } from "node:crypto";
import {
  CLINIC_OS_CLINICAL_SUMMARY_PROFILE,
  CLINIC_OS_FHIR_R4_CORE_PROFILES,
  CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION
} from "./capability.ts";
import { digestClinicOsJson, type ClinicOsSha256Digest } from "./canonical.ts";
import { ClinicOsFhirError } from "./operation-outcome.ts";
import type {
  FhirBundle,
  FhirCodeableConcept,
  FhirComposition,
  FhirConsent,
  FhirDocumentReference,
  FhirEncounter,
  FhirMedicationRequest,
  FhirOrganization,
  FhirPatient,
  FhirPractitioner,
  FhirProvenance,
  FhirReference,
  FhirResource
} from "./types.ts";

export const CLINIC_OS_IDENTIFIER_SYSTEMS = Object.freeze({
  bundle: "https://fhir.clinicos.in/NamingSystem/clinical-summary-bundle-id",
  clinic: "https://fhir.clinicos.in/NamingSystem/clinic-id",
  consent: "https://fhir.clinicos.in/NamingSystem/interoperability-consent-id",
  encounter: "https://fhir.clinicos.in/NamingSystem/encounter-id",
  practitioner: "https://fhir.clinicos.in/NamingSystem/practitioner-id",
  prescription: "https://fhir.clinicos.in/NamingSystem/prescription-id",
  signedClinicalNote: "https://fhir.clinicos.in/NamingSystem/signed-clinical-note-id",
  sourceSnapshot: "https://fhir.clinicos.in/NamingSystem/clinical-summary-source-snapshot",
  tenant: "https://fhir.clinicos.in/NamingSystem/tenant-id"
});

export const CLINIC_OS_INTEROPERABILITY_PURPOSE_SYSTEM =
  "https://fhir.clinicos.in/CodeSystem/interoperability-purpose";
export const CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM =
  "https://fhir.clinicos.in/CodeSystem/interoperability-activity";
export const CLINIC_OS_INTEROPERABILITY_CONSENT_POLICY =
  "https://fhir.clinicos.in/Policy/purpose-specific-interoperability-consent-v1";
export const HL7_CONSENT_ACTION_SYSTEM = "http://terminology.hl7.org/CodeSystem/consentaction";
export const HL7_DATA_OPERATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-DataOperation";
export const HL7_PURPOSE_OF_USE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActReason";

export type InteroperabilityAction = "clinical_summary_export" | "clinical_summary_import";

export interface ClinicalSummaryRecipient {
  readonly identifier: string;
  readonly type: "authorized_organization" | "authorized_system";
}

export interface InteroperabilityConsentDecision {
  readonly action: InteroperabilityAction;
  readonly clinicId: string;
  readonly consentId: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string | null;
  readonly grantedAt: string;
  readonly patientId: string;
  readonly recipient: ClinicalSummaryRecipient;
  readonly revokedAt: string | null;
  readonly scope: "encounter_clinical_summary";
  readonly status: "active" | "expired" | "missing" | "revoked";
  readonly tenantId: string;
}

export interface ClinicalSummarySourceSnapshot {
  readonly schemaVersion: "clinic-os-fhir-r4-clinical-summary-source-v1";
  readonly sourceVersion: number;
  readonly tenant: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly clinic: {
    readonly id: string;
    readonly tenantId: string;
    readonly displayName: string;
  };
  readonly patient: {
    readonly id: string;
    readonly tenantId: string;
    readonly clinicId: string;
    readonly rowVersion: number;
    readonly fullName: string;
    readonly dateOfBirth?: string | null;
    readonly gender?: "female" | "male" | "other" | "unknown" | null;
  };
  readonly encounter: {
    readonly id: string;
    readonly tenantId: string;
    readonly clinicId: string;
    readonly patientId: string;
    readonly providerUserId: string;
    readonly rowVersion: number;
    readonly status: "amended" | "closed" | "signed";
    readonly reason?: string | null;
    readonly startedAt: string;
    readonly closedAt?: string | null;
  };
  readonly practitioner: {
    readonly id: string;
    readonly tenantId: string;
    readonly clinicId: string;
    readonly displayName: string;
    readonly hprId?: string | null;
  };
  readonly clinicalNotes: readonly {
    readonly id: string;
    readonly encounterId: string;
    readonly patientId: string;
    readonly versionNumber: number;
    readonly status: "amended" | "signed";
    readonly sections: Readonly<Record<string, string>>;
    readonly signedAt: string;
    readonly signedByUserId: string;
    readonly signedContentSha256: string;
  }[];
  readonly prescriptions: readonly {
    readonly id: string;
    readonly encounterId: string;
    readonly patientId: string;
    readonly status: "signed";
    readonly medications: readonly {
      readonly name: string;
      readonly strength?: string | null;
      readonly frequency: string;
      readonly duration: string;
      readonly route?: string | null;
      readonly instructions?: string | null;
    }[];
    readonly notes?: string | null;
    readonly signedAt: string;
    readonly signedByUserId: string;
  }[];
}

export interface ClinicalSummaryExportActor {
  readonly displayName: string;
  readonly userId: string;
}

export interface ClinicalSummaryDocumentArtifact {
  readonly bundle: FhirBundle;
  readonly capabilityVersion: typeof CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION;
  readonly consentId: string;
  readonly digest: ClinicOsSha256Digest;
  readonly generatedAt: string;
  readonly sourceVersion: number;
}

export function patientIdentifierSystem(tenantId: string, clinicId: string): string {
  assertUuid(tenantId, "tenantId");
  assertUuid(clinicId, "clinicId");
  return `https://fhir.clinicos.in/NamingSystem/tenant/${tenantId}/clinic/${clinicId}/patient-id`;
}

export function buildClinicalSummaryDocument(input: {
  readonly actor: ClinicalSummaryExportActor;
  readonly bundleId: string;
  readonly consent: InteroperabilityConsentDecision;
  readonly generatedAt: string;
  readonly source: ClinicalSummarySourceSnapshot;
}): ClinicalSummaryDocumentArtifact {
  assertClinicalSummarySource(input.source);
  assertUuid(input.bundleId, "bundleId");
  assertIsoInstant(input.generatedAt, "generatedAt");
  assertClinicalSummaryTimeline(input.source, input.generatedAt);
  assertUuid(input.actor.userId, "actor.userId");
  requiredBounded(input.actor.displayName, "actor.displayName", 200);
  assertConsentAllows(input.consent, {
    action: "clinical_summary_export",
    tenantId: input.source.tenant.id,
    clinicId: input.source.clinic.id,
    patientId: input.source.patient.id,
    evaluatedAt: input.generatedAt
  });
  if (input.actor.userId !== input.source.practitioner.id) {
    throw outcomeError(
      403,
      "FHIR_EXPORT_ACTOR_NOT_AUTHORIZED",
      "The authenticated export actor is not the encounter practitioner in this supported slice.",
      "Practitioner.id",
      "forbidden"
    );
  }

  const sourceDigest = digestClinicOsJson(input.source);
  const compositionId = deterministicUuid(`composition:${input.bundleId}`);
  const provenanceId = deterministicUuid(`provenance:${input.bundleId}`);
  const latestNote = latestClinicalNote(input.source.clinicalNotes);
  const tenant = buildTenant(input.source);
  const clinic = buildClinic(input.source);
  const patient = buildPatient(input.source);
  const practitioner = buildPractitioner(input.source);
  const encounter = buildEncounter(input.source);
  const consent = buildConsent(input.source, input.consent);
  const noteReference = buildClinicalNoteReference(input.source, latestNote);
  const medicationRequests = buildMedicationRequests(input.source);
  const composition = buildComposition({
    source: input.source,
    compositionId,
    consent,
    generatedAt: input.generatedAt,
    latestNote,
    noteReference,
    medicationRequests
  });
  const provenance = buildExportProvenance({
    source: input.source,
    consent,
    composition,
    encounter,
    noteReference,
    medicationRequests,
    provenanceId,
    generatedAt: input.generatedAt,
    sourceDigest
  });

  const resources: FhirResource[] = [
    composition,
    patient,
    encounter,
    practitioner,
    clinic,
    tenant,
    consent,
    noteReference,
    ...medicationRequests,
    provenance
  ];
  const bundle: FhirBundle = {
    resourceType: "Bundle",
    id: input.bundleId,
    identifier: {
      system: CLINIC_OS_IDENTIFIER_SYSTEMS.bundle,
      value: input.bundleId
    },
    meta: {
      profile: [CLINIC_OS_CLINICAL_SUMMARY_PROFILE],
      security: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
          code: "R",
          display: "restricted"
        }
      ],
      tag: [
        {
          system: CLINIC_OS_INTEROPERABILITY_ACTIVITY_SYSTEM,
          code: "clinical-summary-export-v1"
        }
      ]
    },
    timestamp: input.generatedAt,
    type: "document",
    entry: resources.map((resource) => ({
      fullUrl: `urn:uuid:${resource.id}`,
      resource
    }))
  };
  return {
    bundle,
    capabilityVersion: CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION,
    consentId: input.consent.consentId,
    digest: digestClinicOsJson(bundle),
    generatedAt: input.generatedAt,
    sourceVersion: input.source.sourceVersion
  };
}

export function assertConsentAllows(
  consent: InteroperabilityConsentDecision,
  expected: {
    readonly action: InteroperabilityAction;
    readonly clinicId: string;
    readonly evaluatedAt: string;
    readonly patientId: string;
    readonly tenantId: string;
  }
): void {
  assertIsoInstant(expected.evaluatedAt, "consent.evaluatedAt");
  const scopeMatches =
    consent.action === expected.action &&
    consent.scope === "encounter_clinical_summary" &&
    consent.tenantId === expected.tenantId &&
    consent.clinicId === expected.clinicId &&
    consent.patientId === expected.patientId;
  if (!scopeMatches) {
    throw outcomeError(
      403,
      "FHIR_CONSENT_SCOPE_MISMATCH",
      "Purpose-specific interoperability consent does not match the authorized tenant, clinic, patient, action and summary scope.",
      "Consent.provision",
      "forbidden"
    );
  }
  if (consent.status !== "active" || consent.revokedAt) {
    throw outcomeError(
      409,
      consent.status === "revoked" || consent.revokedAt
        ? "FHIR_CONSENT_REVOKED"
        : consent.status === "expired"
          ? "FHIR_CONSENT_EXPIRED"
          : "FHIR_CONSENT_REQUIRED",
      "Active purpose-specific interoperability consent is required at action time.",
      "Consent.status",
      "business-rule"
    );
  }
  const evaluated = Date.parse(expected.evaluatedAt);
  const granted = Date.parse(consent.grantedAt);
  const expires = consent.expiresAt ? Date.parse(consent.expiresAt) : null;
  if (
    !Number.isFinite(granted) ||
    granted > evaluated ||
    (expires !== null && expires <= evaluated)
  ) {
    throw outcomeError(
      409,
      expires !== null && expires <= evaluated
        ? "FHIR_CONSENT_EXPIRED"
        : "FHIR_CONSENT_NOT_YET_EFFECTIVE",
      "Interoperability consent is not effective at the action timestamp.",
      "Consent.provision.period",
      "business-rule"
    );
  }
}

function buildTenant(source: ClinicalSummarySourceSnapshot): FhirOrganization {
  return {
    resourceType: "Organization",
    id: source.tenant.id,
    meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Organization] },
    text: narrative(`Organization: ${source.tenant.displayName}`),
    active: true,
    identifier: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.tenant, value: source.tenant.id }],
    name: source.tenant.displayName
  };
}

function buildClinic(source: ClinicalSummarySourceSnapshot): FhirOrganization {
  return {
    resourceType: "Organization",
    id: source.clinic.id,
    meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Organization] },
    text: narrative(`Clinic: ${source.clinic.displayName}`),
    active: true,
    identifier: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.clinic, value: source.clinic.id }],
    name: source.clinic.displayName,
    partOf: ref("Organization", source.tenant.id, source.tenant.displayName)
  };
}

function buildPatient(source: ClinicalSummarySourceSnapshot): FhirPatient {
  return {
    resourceType: "Patient",
    id: source.patient.id,
    meta: {
      profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Patient],
      versionId: String(source.patient.rowVersion)
    },
    text: narrative(`Patient: ${source.patient.fullName}`),
    active: true,
    identifier: [
      {
        system: patientIdentifierSystem(source.tenant.id, source.clinic.id),
        value: source.patient.id
      }
    ],
    managingOrganization: ref("Organization", source.clinic.id, source.clinic.displayName),
    name: [{ text: source.patient.fullName }],
    ...(source.patient.dateOfBirth ? { birthDate: source.patient.dateOfBirth } : {}),
    gender: source.patient.gender ?? "unknown"
  };
}

function buildPractitioner(source: ClinicalSummarySourceSnapshot): FhirPractitioner {
  return {
    resourceType: "Practitioner",
    id: source.practitioner.id,
    meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Practitioner] },
    text: narrative(`Practitioner: ${source.practitioner.displayName}`),
    active: true,
    identifier: [
      {
        system: CLINIC_OS_IDENTIFIER_SYSTEMS.practitioner,
        value: source.practitioner.id
      },
      ...(source.practitioner.hprId
        ? [
            {
              system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/hpr-id",
              value: source.practitioner.hprId
            }
          ]
        : [])
    ],
    name: [{ text: source.practitioner.displayName }]
  };
}

function buildEncounter(source: ClinicalSummarySourceSnapshot): FhirEncounter {
  return {
    resourceType: "Encounter",
    id: source.encounter.id,
    meta: {
      profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Encounter],
      versionId: String(source.encounter.rowVersion)
    },
    text: narrative(`Finished ambulatory encounter for ${source.patient.fullName}`),
    identifier: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.encounter, value: source.encounter.id }],
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory"
    },
    participant: [
      {
        individual: ref("Practitioner", source.practitioner.id, source.practitioner.displayName),
        type: [
          codeable(
            "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
            "PPRF",
            "primary performer"
          )
        ]
      }
    ],
    period: {
      start: source.encounter.startedAt,
      ...(source.encounter.closedAt ? { end: source.encounter.closedAt } : {})
    },
    ...(source.encounter.reason ? { reasonCode: [{ text: source.encounter.reason }] } : {}),
    serviceProvider: ref("Organization", source.clinic.id, source.clinic.displayName),
    status: "finished",
    subject: ref("Patient", source.patient.id, source.patient.fullName)
  };
}

function buildConsent(
  source: ClinicalSummarySourceSnapshot,
  authorization: InteroperabilityConsentDecision
): FhirConsent {
  return {
    resourceType: "Consent",
    id: authorization.consentId,
    meta: {
      profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Consent]
    },
    text: narrative("Active purpose-specific consent for disclosure of this clinical summary"),
    identifier: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.consent, value: authorization.consentId }],
    status: "active",
    scope: codeable(
      "http://terminology.hl7.org/CodeSystem/consentscope",
      "patient-privacy",
      "Privacy Consent"
    ),
    category: [codeable("http://loinc.org", "59284-0", "Consent Document")],
    patient: ref("Patient", source.patient.id, source.patient.fullName),
    dateTime: authorization.grantedAt,
    organization: [ref("Organization", source.clinic.id, source.clinic.displayName)],
    policy: [{ uri: CLINIC_OS_INTEROPERABILITY_CONSENT_POLICY }],
    provision: {
      type: "permit",
      period: {
        start: authorization.grantedAt,
        ...(authorization.expiresAt ? { end: authorization.expiresAt } : {})
      },
      action: [codeable(HL7_CONSENT_ACTION_SYSTEM, "disclose", "Disclose")],
      class: [
        {
          system: "http://hl7.org/fhir/resource-types",
          code: "Bundle",
          display: "Bundle"
        }
      ],
      purpose: [
        {
          system: HL7_PURPOSE_OF_USE_SYSTEM,
          code: "TREAT",
          display: "treatment"
        }
      ],
      data: [
        {
          meaning: "related",
          reference: ref("Encounter", source.encounter.id)
        }
      ]
    }
  };
}

function buildClinicalNoteReference(
  source: ClinicalSummarySourceSnapshot,
  note: ClinicalSummarySourceSnapshot["clinicalNotes"][number]
): FhirDocumentReference {
  return {
    resourceType: "DocumentReference",
    id: note.id,
    meta: {
      profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.DocumentReference],
      versionId: String(note.versionNumber)
    },
    text: narrative("Signed ClinicOS clinical note evidence"),
    identifier: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.signedClinicalNote, value: note.id }],
    status: "current",
    docStatus: note.status === "amended" ? "amended" : "final",
    type: codeable("http://loinc.org", "11506-3", "Progress note"),
    subject: ref("Patient", source.patient.id, source.patient.fullName),
    date: note.signedAt,
    author: [ref("Practitioner", source.practitioner.id, source.practitioner.displayName)],
    description: "Signed ClinicOS clinical note evidence represented in the Composition narrative.",
    securityLabel: [
      codeable("http://terminology.hl7.org/CodeSystem/v3-Confidentiality", "R", "restricted")
    ],
    content: [
      {
        attachment: {
          contentType: "application/fhir+json",
          creation: note.signedAt,
          hash: Buffer.from(note.signedContentSha256, "hex").toString("base64"),
          title: "Signed clinical note evidence",
          url: `urn:clinicos:document-evidence:${note.id}`
        }
      }
    ],
    context: {
      encounter: [ref("Encounter", source.encounter.id)]
    }
  };
}

function buildMedicationRequests(source: ClinicalSummarySourceSnapshot): FhirMedicationRequest[] {
  return source.prescriptions.flatMap((prescription) =>
    prescription.medications.map((medication, index) => ({
      resourceType: "MedicationRequest" as const,
      id: deterministicUuid(`medication:${prescription.id}:${index}`),
      meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.MedicationRequest] },
      text: narrative(
        `Medication order: ${[medication.name, medication.strength].filter(Boolean).join(" ")}`
      ),
      identifier: [
        {
          system: CLINIC_OS_IDENTIFIER_SYSTEMS.prescription,
          value: `${prescription.id}:${index + 1}`
        }
      ],
      status: "active" as const,
      intent: "order" as const,
      medicationCodeableConcept: {
        text: [medication.name, medication.strength].filter(Boolean).join(" ")
      },
      subject: ref("Patient", source.patient.id, source.patient.fullName),
      encounter: ref("Encounter", source.encounter.id),
      authoredOn: prescription.signedAt,
      requester: ref("Practitioner", source.practitioner.id, source.practitioner.displayName),
      dosageInstruction: [
        {
          text: [
            medication.frequency,
            `for ${medication.duration}`,
            medication.route ? `via ${medication.route}` : null,
            medication.instructions ?? null
          ]
            .filter(Boolean)
            .join("; ")
        }
      ],
      ...(prescription.notes ? { note: [{ text: prescription.notes }] } : {})
    }))
  );
}

function buildComposition(input: {
  readonly compositionId: string;
  readonly consent: FhirConsent;
  readonly generatedAt: string;
  readonly latestNote: ClinicalSummarySourceSnapshot["clinicalNotes"][number];
  readonly medicationRequests: readonly FhirMedicationRequest[];
  readonly noteReference: FhirDocumentReference;
  readonly source: ClinicalSummarySourceSnapshot;
}): FhirComposition {
  const sections: FhirComposition["section"] = [
    {
      title: "Clinical note",
      code: codeable("http://loinc.org", "11506-3", "Progress note"),
      text: {
        status: "generated",
        div: noteNarrative(input.latestNote.sections)
      },
      entry: [ref("DocumentReference", input.noteReference.id)]
    },
    {
      title: "Interoperability authorization",
      code: codeable("http://loinc.org", "59284-0", "Consent Document"),
      text: narrative("Purpose-specific consent authorizes disclosure of this clinical summary"),
      entry: [ref("Consent", input.consent.id)]
    }
  ];
  if (input.medicationRequests.length > 0) {
    sections.push({
      title: "Medications",
      code: codeable("http://loinc.org", "10160-0", "History of Medication use Narrative"),
      text: {
        status: "generated",
        div: medicationNarrative(input.medicationRequests)
      },
      entry: input.medicationRequests.map((medication) => ref("MedicationRequest", medication.id))
    });
  }
  return {
    resourceType: "Composition",
    id: input.compositionId,
    meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Composition] },
    text: narrative("ClinicOS encounter clinical summary"),
    status: input.latestNote.status === "amended" ? "amended" : "final",
    type: codeable("http://loinc.org", "34133-9", "Summary of episode note"),
    subject: ref("Patient", input.source.patient.id, input.source.patient.fullName),
    encounter: ref("Encounter", input.source.encounter.id),
    date: input.generatedAt,
    author: [
      ref("Practitioner", input.source.practitioner.id, input.source.practitioner.displayName)
    ],
    title: "ClinicOS encounter clinical summary",
    custodian: ref("Organization", input.source.clinic.id, input.source.clinic.displayName),
    section: sections
  };
}

function buildExportProvenance(input: {
  readonly composition: FhirComposition;
  readonly consent: FhirConsent;
  readonly encounter: FhirEncounter;
  readonly generatedAt: string;
  readonly medicationRequests: readonly FhirMedicationRequest[];
  readonly noteReference: FhirDocumentReference;
  readonly provenanceId: string;
  readonly source: ClinicalSummarySourceSnapshot;
  readonly sourceDigest: ClinicOsSha256Digest;
}): FhirProvenance {
  return {
    resourceType: "Provenance",
    id: input.provenanceId,
    meta: { profile: [CLINIC_OS_FHIR_R4_CORE_PROFILES.Provenance] },
    text: narrative("Provenance for creation of the ClinicOS clinical summary export"),
    target: [
      ref("Composition", input.composition.id),
      ref("Encounter", input.encounter.id),
      ref("DocumentReference", input.noteReference.id),
      ...input.medicationRequests.map((medication) => ref("MedicationRequest", medication.id))
    ],
    occurredDateTime: input.generatedAt,
    recorded: input.generatedAt,
    policy: [CLINIC_OS_INTEROPERABILITY_CONSENT_POLICY],
    activity: codeable(HL7_DATA_OPERATION_SYSTEM, "CREATE", "create"),
    reason: [codeable(HL7_PURPOSE_OF_USE_SYSTEM, "TREAT", "treatment")],
    agent: [
      {
        role: [
          codeable(
            "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
            "AUT",
            "author (originator)"
          )
        ],
        who: ref(
          "Practitioner",
          input.source.practitioner.id,
          input.source.practitioner.displayName
        ),
        onBehalfOf: ref("Organization", input.source.clinic.id, input.source.clinic.displayName)
      }
    ],
    entity: [
      {
        role: "source",
        what: {
          identifier: {
            system: CLINIC_OS_IDENTIFIER_SYSTEMS.sourceSnapshot,
            value: input.sourceDigest.value
          },
          display: "Digest of the server-derived ClinicOS source snapshot"
        }
      },
      {
        role: "source",
        what: ref("Consent", input.consent.id)
      }
    ]
  };
}

function assertClinicalSummarySource(source: ClinicalSummarySourceSnapshot): void {
  if (source.schemaVersion !== "clinic-os-fhir-r4-clinical-summary-source-v1") {
    throw outcomeError(
      422,
      "FHIR_SOURCE_SCHEMA_UNSUPPORTED",
      "The clinical summary source schema version is unsupported.",
      "source.schemaVersion",
      "not-supported"
    );
  }
  for (const [field, value] of [
    ["tenant.id", source.tenant.id],
    ["clinic.id", source.clinic.id],
    ["patient.id", source.patient.id],
    ["encounter.id", source.encounter.id],
    ["practitioner.id", source.practitioner.id]
  ] as const) {
    assertUuid(value, field);
  }
  if (
    source.clinic.tenantId !== source.tenant.id ||
    source.patient.tenantId !== source.tenant.id ||
    source.encounter.tenantId !== source.tenant.id ||
    source.practitioner.tenantId !== source.tenant.id ||
    source.patient.clinicId !== source.clinic.id ||
    source.encounter.clinicId !== source.clinic.id ||
    source.practitioner.clinicId !== source.clinic.id ||
    source.encounter.patientId !== source.patient.id ||
    source.encounter.providerUserId !== source.practitioner.id
  ) {
    throw outcomeError(
      403,
      "FHIR_SOURCE_SCOPE_MISMATCH",
      "Clinical summary source rows do not share the authorized tenant, clinic, patient and practitioner scope.",
      "source",
      "forbidden"
    );
  }
  positiveVersion(source.sourceVersion, "source.sourceVersion");
  positiveVersion(source.patient.rowVersion, "source.patient.rowVersion");
  positiveVersion(source.encounter.rowVersion, "source.encounter.rowVersion");
  requiredBounded(source.tenant.displayName, "tenant.displayName", 200);
  requiredBounded(source.clinic.displayName, "clinic.displayName", 200);
  requiredBounded(source.patient.fullName, "patient.fullName", 200);
  requiredBounded(source.practitioner.displayName, "practitioner.displayName", 200);
  optionalBounded(source.practitioner.hprId, "practitioner.hprId", 100);
  if (source.patient.dateOfBirth && !validDateOnly(source.patient.dateOfBirth)) {
    throw outcomeError(
      422,
      "FHIR_BIRTH_DATE_INVALID",
      "Patient date of birth must be a valid FHIR date in YYYY-MM-DD form.",
      "source.patient.dateOfBirth",
      "value"
    );
  }
  assertIsoInstant(source.encounter.startedAt, "encounter.startedAt");
  if (!source.encounter.closedAt) {
    throw outcomeError(
      422,
      "FHIR_CLOSED_ENCOUNTER_REQUIRED",
      "A final encounter clinical summary requires a closed encounter timestamp.",
      "source.encounter.closedAt",
      "required"
    );
  }
  assertIsoInstant(source.encounter.closedAt, "encounter.closedAt");
  optionalBounded(source.encounter.reason, "encounter.reason", 500);
  if (source.clinicalNotes.length === 0 || source.clinicalNotes.length > 100) {
    throw outcomeError(
      422,
      "FHIR_SIGNED_NOTE_COUNT_INVALID",
      "The supported clinical summary requires between one and 100 signed/amended note versions.",
      "source.clinicalNotes",
      "value"
    );
  }
  const noteContentCharacters = source.clinicalNotes.reduce(
    (total, note) =>
      total +
      Object.entries(note.sections).reduce(
        (sectionTotal, [key, value]) => sectionTotal + key.length + value.length,
        0
      ),
    0
  );
  if (noteContentCharacters > 100_000) {
    throw outcomeError(
      422,
      "FHIR_NOTE_CONTENT_LIMIT_EXCEEDED",
      "Signed clinical note source content exceeds the 100,000-character export limit.",
      "source.clinicalNotes",
      "too-costly"
    );
  }
  for (const [index, note] of source.clinicalNotes.entries()) {
    assertUuid(note.id, `clinicalNotes[${index}].id`);
    if (
      note.patientId !== source.patient.id ||
      note.encounterId !== source.encounter.id ||
      note.signedByUserId !== source.practitioner.id
    ) {
      throw outcomeError(
        403,
        "FHIR_NOTE_SCOPE_MISMATCH",
        "A clinical note is outside the authorized patient, encounter or signer scope.",
        `source.clinicalNotes[${index}]`,
        "forbidden"
      );
    }
    positiveVersion(note.versionNumber, `clinicalNotes[${index}].versionNumber`);
    assertIsoInstant(note.signedAt, `clinicalNotes[${index}].signedAt`);
    if (!/^[a-f0-9]{64}$/u.test(note.signedContentSha256)) {
      throw outcomeError(
        422,
        "FHIR_NOTE_DIGEST_INVALID",
        "Signed clinical note integrity evidence must be a SHA-256 hex digest.",
        `source.clinicalNotes[${index}].signedContentSha256`,
        "value"
      );
    }
    if (Object.keys(note.sections).length === 0 || Object.keys(note.sections).length > 50) {
      throw outcomeError(
        422,
        "FHIR_NOTE_SECTION_COUNT_INVALID",
        "Signed clinical notes require between one and 50 bounded sections.",
        `source.clinicalNotes[${index}].sections`,
        "value"
      );
    }
    for (const [key, value] of Object.entries(note.sections)) {
      requiredBounded(key, `clinicalNotes[${index}].sections key`, 80);
      requiredBounded(value, `clinicalNotes[${index}].sections.${key}`, 10_000);
    }
  }
  const medicationCount = source.prescriptions.reduce(
    (count, prescription) => count + prescription.medications.length,
    0
  );
  if (source.prescriptions.length > 50 || medicationCount > 200) {
    throw outcomeError(
      422,
      "FHIR_PRESCRIPTION_COUNT_INVALID",
      "The clinical summary supports at most 50 prescriptions and 200 medication entries.",
      "source.prescriptions",
      "too-costly"
    );
  }
  for (const [index, prescription] of source.prescriptions.entries()) {
    assertUuid(prescription.id, `prescriptions[${index}].id`);
    if (
      prescription.patientId !== source.patient.id ||
      prescription.encounterId !== source.encounter.id ||
      prescription.signedByUserId !== source.practitioner.id
    ) {
      throw outcomeError(
        403,
        "FHIR_PRESCRIPTION_SCOPE_MISMATCH",
        "A prescription is outside the authorized patient, encounter or signer scope.",
        `source.prescriptions[${index}]`,
        "forbidden"
      );
    }
    assertIsoInstant(prescription.signedAt, `prescriptions[${index}].signedAt`);
    optionalBounded(prescription.notes, `prescriptions[${index}].notes`, 2_000);
    if (prescription.medications.length === 0 || prescription.medications.length > 50) {
      throw outcomeError(
        422,
        "FHIR_MEDICATION_COUNT_INVALID",
        "A signed prescription must contain between one and 50 medications.",
        `source.prescriptions[${index}].medications`,
        "value"
      );
    }
    for (const [medicationIndex, medication] of prescription.medications.entries()) {
      requiredBounded(
        medication.name,
        `prescriptions[${index}].medications[${medicationIndex}].name`,
        300
      );
      requiredBounded(
        medication.frequency,
        `prescriptions[${index}].medications[${medicationIndex}].frequency`,
        200
      );
      requiredBounded(
        medication.duration,
        `prescriptions[${index}].medications[${medicationIndex}].duration`,
        200
      );
      optionalBounded(
        medication.strength,
        `prescriptions[${index}].medications[${medicationIndex}].strength`,
        100
      );
      optionalBounded(
        medication.route,
        `prescriptions[${index}].medications[${medicationIndex}].route`,
        100
      );
      optionalBounded(
        medication.instructions,
        `prescriptions[${index}].medications[${medicationIndex}].instructions`,
        1_000
      );
    }
  }
}

function assertClinicalSummaryTimeline(
  source: ClinicalSummarySourceSnapshot,
  generatedAt: string
): void {
  const generated = Date.parse(generatedAt);
  const started = Date.parse(source.encounter.startedAt);
  const closed = Date.parse(source.encounter.closedAt!);
  const clinicalInstants = [
    ...source.clinicalNotes.map((note) => note.signedAt),
    ...source.prescriptions.map((prescription) => prescription.signedAt)
  ].map(Date.parse);
  if (
    closed < started ||
    closed > generated ||
    clinicalInstants.some((instant) => instant < started || instant > generated)
  ) {
    throw outcomeError(
      422,
      "FHIR_SOURCE_TIMELINE_INVALID",
      "Encounter close, clinical signatures and export generation must form a valid monotonic timeline.",
      "source",
      "value"
    );
  }
}

function latestClinicalNote(
  notes: ClinicalSummarySourceSnapshot["clinicalNotes"]
): ClinicalSummarySourceSnapshot["clinicalNotes"][number] {
  return [...notes].sort(
    (left, right) =>
      right.versionNumber - left.versionNumber || right.signedAt.localeCompare(left.signedAt)
  )[0]!;
}

function noteNarrative(sections: Readonly<Record<string, string>>): string {
  const body = Object.entries(sections)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `<div><h2>${escapeHtml(titleFromKey(key))}</h2><p>${escapeHtml(value)}</p></div>`
    )
    .join("");
  return `<div xmlns="http://www.w3.org/1999/xhtml">${body}</div>`;
}

function medicationNarrative(medications: readonly FhirMedicationRequest[]): string {
  const items = medications
    .map((medication) => {
      const name = medication.medicationCodeableConcept.text ?? "Medication";
      const dosage = medication.dosageInstruction?.[0]?.text ?? "Instructions unavailable";
      return `<li>${escapeHtml(name)} — ${escapeHtml(dosage)}</li>`;
    })
    .join("");
  return `<div xmlns="http://www.w3.org/1999/xhtml"><ul>${items}</ul></div>`;
}

function narrative(summary: string): { readonly div: string; readonly status: "generated" } {
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(summary)}</p></div>`
  };
}

function deterministicUuid(value: string): string {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function ref(
  resourceType: FhirResource["resourceType"],
  id: string,
  display?: string
): FhirReference {
  return {
    reference: `urn:uuid:${id}`,
    ...(display ? { display } : {})
  };
}

function codeable(system: string, code: string, display: string): FhirCodeableConcept {
  return {
    coding: [{ system, code, display }],
    text: display
  };
}

function assertUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw outcomeError(
      422,
      "FHIR_IDENTIFIER_INVALID",
      `${field} must be a UUID-backed FHIR id.`,
      field,
      "value"
    );
  }
}

function assertIsoInstant(value: string, field: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw outcomeError(
      422,
      "FHIR_DATETIME_INVALID",
      `${field} must be an ISO 8601 dateTime with an explicit offset.`,
      field,
      "value"
    );
  }
}

function positiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw outcomeError(
      409,
      "FHIR_VERSION_INVALID",
      `${field} must be a positive safe integer.`,
      field,
      "conflict"
    );
  }
}

function requiredBounded(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) {
    throw outcomeError(
      422,
      "FHIR_STRING_INVALID",
      `${field} is required and must not exceed ${maximum} characters or contain control characters.`,
      field,
      "value"
    );
  }
  return normalized;
}

function optionalBounded(value: string | null | undefined, field: string, maximum: number): void {
  if (value !== null && value !== undefined) requiredBounded(value, field, maximum);
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function titleFromKey(value: string): string {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (first) => first.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function outcomeError(
  httpStatus: number,
  clinicOsCode: string,
  diagnostics: string,
  expression: string,
  code:
    | "business-rule"
    | "conflict"
    | "forbidden"
    | "not-supported"
    | "required"
    | "too-costly"
    | "value"
): ClinicOsFhirError {
  return new ClinicOsFhirError({
    httpStatus,
    issues: [{ clinicOsCode, diagnostics, expression: [expression], code }]
  });
}
