import type {
  ClinicalSummarySourceSnapshot,
  InteroperabilityConsentDecision
} from "../src/index.ts";

export const IDS = Object.freeze({
  actor: "30000000-0000-4000-8000-000000000007",
  bundle: "30000000-0000-4000-8000-000000000010",
  clinic: "30000000-0000-4000-8000-000000000002",
  consent: "30000000-0000-4000-8000-000000000009",
  encounter: "30000000-0000-4000-8000-000000000004",
  note: "30000000-0000-4000-8000-000000000006",
  patient: "30000000-0000-4000-8000-000000000003",
  prescription: "30000000-0000-4000-8000-000000000008",
  tenant: "30000000-0000-4000-8000-000000000001"
});

export const GENERATED_AT = "2026-07-14T10:00:00.000Z";

export function sourceFixture(): ClinicalSummarySourceSnapshot {
  return {
    schemaVersion: "clinic-os-fhir-r4-clinical-summary-source-v1",
    sourceVersion: 7,
    tenant: { id: IDS.tenant, displayName: "Synthetic ClinicOS tenant" },
    clinic: {
      id: IDS.clinic,
      tenantId: IDS.tenant,
      displayName: "Synthetic Dental Clinic"
    },
    patient: {
      id: IDS.patient,
      tenantId: IDS.tenant,
      clinicId: IDS.clinic,
      rowVersion: 4,
      fullName: "Synthetic Patient",
      dateOfBirth: "1990-03-04",
      gender: "female"
    },
    encounter: {
      id: IDS.encounter,
      tenantId: IDS.tenant,
      clinicId: IDS.clinic,
      patientId: IDS.patient,
      providerUserId: IDS.actor,
      rowVersion: 7,
      status: "signed",
      reason: "Synthetic follow-up",
      startedAt: "2026-07-14T09:00:00.000Z",
      closedAt: "2026-07-14T09:45:00.000Z"
    },
    practitioner: {
      id: IDS.actor,
      tenantId: IDS.tenant,
      clinicId: IDS.clinic,
      displayName: "Dr Synthetic"
    },
    clinicalNotes: [
      {
        id: IDS.note,
        encounterId: IDS.encounter,
        patientId: IDS.patient,
        versionNumber: 2,
        status: "signed",
        sections: {
          diagnosis: "Synthetic gingivitis finding",
          treatmentPlan: "Synthetic preventive care plan"
        },
        signedAt: "2026-07-14T09:40:00.000Z",
        signedByUserId: IDS.actor,
        signedContentSha256: "a".repeat(64)
      }
    ],
    prescriptions: [
      {
        id: IDS.prescription,
        encounterId: IDS.encounter,
        patientId: IDS.patient,
        status: "signed",
        medications: [
          {
            name: "Synthetic mouth rinse",
            strength: "0.2%",
            frequency: "twice daily",
            duration: "7 days",
            route: "oral",
            instructions: "Do not swallow"
          }
        ],
        notes: "Synthetic medication data only",
        signedAt: "2026-07-14T09:42:00.000Z",
        signedByUserId: IDS.actor
      }
    ]
  };
}

export function consentFixture(
  overrides: Partial<InteroperabilityConsentDecision> = {}
): InteroperabilityConsentDecision {
  return {
    action: "clinical_summary_export",
    clinicId: IDS.clinic,
    consentId: IDS.consent,
    evaluatedAt: GENERATED_AT,
    expiresAt: "2026-08-14T10:00:00.000Z",
    grantedAt: "2026-07-01T10:00:00.000Z",
    patientId: IDS.patient,
    recipient: {
      identifier: "authorized-recipient-1",
      type: "authorized_organization"
    },
    revokedAt: null,
    scope: "encounter_clinical_summary",
    status: "active",
    tenantId: IDS.tenant,
    ...overrides
  };
}
