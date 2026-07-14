import {
  CLINIC_OS_IDENTIFIER_SYSTEMS,
  digestClinicOsJson,
  patientIdentifierSystem,
  type AuthorizedEncounterMatchCandidate,
  type AuthorizedPatientMatchCandidate,
  type ClinicalSummaryRecipient,
  type ClinicalSummarySourceSnapshot,
  type FhirIdentifier,
  type InteroperabilityAction,
  type InteroperabilityConsentDecision
} from "@clinic-os/fhir";
import type { SqlQueryClient } from "@clinic-os/db";
import type {
  AuthenticatedInteroperabilityContext,
  ClinicalSummarySourceRead,
  InteroperabilityClinicalSourcePort,
  InteroperabilityConsentPort
} from "../../features/cp16-interoperability/index.ts";
import {
  iso,
  positiveInteger,
  uuid,
  withInteroperabilityScope,
  type Cp16InteroperabilityUnitOfWork
} from "./postgres-interoperability-shared.ts";

interface SourceRow extends Record<string, unknown> {
  readonly tenant_id: string;
  readonly tenant_display_name: string;
  readonly clinic_id: string;
  readonly clinic_display_name: string;
  readonly patient_id: string;
  readonly patient_row_version: string | number;
  readonly full_name: string;
  readonly date_of_birth: string | Date | null;
  readonly gender: "female" | "male" | "other" | "unknown";
  readonly encounter_id: string;
  readonly encounter_row_version: string | number;
  readonly encounter_status: "amended" | "closed" | "signed";
  readonly reason: string | null;
  readonly started_at: string | Date;
  readonly closed_at: string | Date | null;
  readonly provider_user_id: string;
  readonly practitioner_display_name: string;
}

interface NoteRow extends Record<string, unknown> {
  readonly id: string;
  readonly encounter_id: string;
  readonly patient_id: string;
  readonly version_number: string | number;
  readonly status: "amended" | "signed";
  readonly content: unknown;
  readonly signed_at: string | Date;
  readonly signed_by_user_id: string;
}

interface PrescriptionRow extends Record<string, unknown> {
  readonly id: string;
  readonly encounter_id: string;
  readonly patient_id: string;
  readonly medications: unknown;
  readonly notes: string | null;
  readonly signed_at: string | Date;
  readonly signed_by_user_id: string;
}

interface MatchRow extends Record<string, unknown> {
  readonly id: string;
  readonly row_version: string | number;
}

interface ConsentRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: "active" | "revoked";
  readonly evidence: unknown;
  readonly created_at: string | Date;
  readonly revoked_at: string | Date | null;
}

const MISSING_CONSENT_ID = "00000000-0000-4000-8000-000000000000";

export class PostgresInteroperabilityClinicalSource implements InteroperabilityClinicalSourcePort {
  readonly #unitOfWork: Cp16InteroperabilityUnitOfWork;

  constructor(unitOfWork: Cp16InteroperabilityUnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  loadClinicalSummary(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly encounterId: string;
    readonly expectedSourceVersion: number;
    readonly patientId: string;
  }): Promise<ClinicalSummarySourceRead> {
    if (!uuid(input.patientId) || !uuid(input.encounterId)) {
      throw new Error("Interoperability source identity is invalid.");
    }
    positiveInteger(input.expectedSourceVersion, "expected source version");
    return withInteroperabilityScope(this.#unitOfWork, input.context, async (client) => {
      const source = await client.query<SourceRow>(
        `select t.id as tenant_id, t.display_name as tenant_display_name,
                c.id as clinic_id, c.display_name as clinic_display_name,
                p.id as patient_id, p.row_version as patient_row_version,
                p.full_name, p.date_of_birth, p.gender,
                e.id as encounter_id, e.row_version as encounter_row_version,
                e.status as encounter_status, e.reason, e.started_at, e.closed_at,
                e.provider_user_id, u.display_name as practitioner_display_name
           from encounters e
           join patients p on p.tenant_id = e.tenant_id and p.clinic_id = e.clinic_id
                          and p.id = e.patient_id
           join clinics c on c.tenant_id = e.tenant_id and c.id = e.clinic_id
           join tenants t on t.id = e.tenant_id
           join users u on u.id = e.provider_user_id
          where e.tenant_id = $1 and e.clinic_id = $2 and e.id = $3 and e.patient_id = $4
            and e.status in ('signed','amended','closed')
            and e.started_at is not null`,
        [input.context.tenantId, input.context.clinicId, input.encounterId, input.patientId]
      );
      const row = source.rows[0];
      if (!row) return { kind: "not_found" };
      const sourceVersion = positiveInteger(row.encounter_row_version, "source row version");
      if (sourceVersion !== input.expectedSourceVersion) {
        return { kind: "version_conflict", actualVersion: sourceVersion };
      }
      const [notes, prescriptions] = await Promise.all([
        client.query<NoteRow>(
          `select id, encounter_id, patient_id, version_number, status, content,
                  signed_at, signed_by_user_id
             from clinical_note_versions
            where tenant_id = $1 and clinic_id = $2 and encounter_id = $3 and patient_id = $4
              and status in ('signed','amended')
            order by version_number asc
            limit 129`,
          [input.context.tenantId, input.context.clinicId, input.encounterId, input.patientId]
        ),
        client.query<PrescriptionRow>(
          `select id, encounter_id, patient_id, medications, notes, signed_at, signed_by_user_id
             from prescriptions
            where tenant_id = $1 and clinic_id = $2 and encounter_id = $3 and patient_id = $4
              and status = 'signed'
            order by created_at asc
            limit 129`,
          [input.context.tenantId, input.context.clinicId, input.encounterId, input.patientId]
        )
      ]);
      return {
        kind: "found",
        source: sourceSnapshot(row, sourceVersion, notes.rows, prescriptions.rows)
      };
    });
  }

  findExactPatientMatches(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly identifiers: readonly FhirIdentifier[];
  }): Promise<readonly AuthorizedPatientMatchCandidate[]> {
    const system = patientIdentifierSystem(input.context.tenantId, input.context.clinicId);
    const ids = [
      ...new Set(
        input.identifiers.filter((item) => item.system === system).map((item) => item.value)
      )
    ]
      .filter(uuid)
      .slice(0, 128);
    if (ids.length === 0) return Promise.resolve([]);
    return withInteroperabilityScope(this.#unitOfWork, input.context, async (client) => {
      const result = await client.query<MatchRow>(
        `select id, row_version from patients
          where tenant_id = $1 and clinic_id = $2 and id = any($3::uuid[])
          order by id`,
        [input.context.tenantId, input.context.clinicId, ids]
      );
      return result.rows.map((row) => ({
        tenantId: input.context.tenantId,
        clinicId: input.context.clinicId,
        patientId: row.id,
        rowVersion: positiveInteger(row.row_version, "patient row version"),
        identifiers: [{ system, value: row.id }]
      }));
    });
  }

  findExactEncounterMatches(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly identifier: FhirIdentifier;
    readonly patientId: string;
  }): Promise<readonly AuthorizedEncounterMatchCandidate[]> {
    if (
      input.identifier.system !== CLINIC_OS_IDENTIFIER_SYSTEMS.encounter ||
      !uuid(input.identifier.value) ||
      !uuid(input.patientId)
    ) {
      return Promise.resolve([]);
    }
    return withInteroperabilityScope(this.#unitOfWork, input.context, async (client) => {
      const result = await client.query<MatchRow>(
        `select id, row_version from encounters
          where tenant_id = $1 and clinic_id = $2 and id = $3 and patient_id = $4`,
        [input.context.tenantId, input.context.clinicId, input.identifier.value, input.patientId]
      );
      return result.rows.map((row) => ({
        tenantId: input.context.tenantId,
        clinicId: input.context.clinicId,
        patientId: input.patientId,
        encounterId: row.id,
        rowVersion: positiveInteger(row.row_version, "encounter row version"),
        identifiers: [{ system: CLINIC_OS_IDENTIFIER_SYSTEMS.encounter, value: row.id }]
      }));
    });
  }
}

export class PostgresInteroperabilityConsent implements InteroperabilityConsentPort {
  readonly #unitOfWork: Cp16InteroperabilityUnitOfWork;

  constructor(unitOfWork: Cp16InteroperabilityUnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  authorize(input: {
    readonly action: InteroperabilityAction;
    readonly context: AuthenticatedInteroperabilityContext;
    readonly evaluatedAt: string;
    readonly patientId: string;
    readonly recipient: ClinicalSummaryRecipient;
    readonly scope: "encounter_clinical_summary";
  }): Promise<InteroperabilityConsentDecision> {
    if (!uuid(input.patientId)) throw new Error("Interoperability consent patient is invalid.");
    const evaluatedAt = iso(input.evaluatedAt, "consent evaluation time");
    return withInteroperabilityScope(this.#unitOfWork, input.context, async (client) => {
      const rows = await client.query<ConsentRow>(
        `select id, status, evidence, created_at, revoked_at
           from consents
          where tenant_id = $1 and clinic_id = $2 and patient_id = $3
            and purpose = 'clinical_data_exchange'
          order by created_at desc
          limit 32`,
        [input.context.tenantId, input.context.clinicId, input.patientId]
      );
      for (const row of rows.rows) {
        const binding = consentBinding(row.evidence);
        if (!binding || !binding.actions.includes(input.action)) continue;
        if (
          binding.scope !== input.scope ||
          binding.recipient.type !== input.recipient.type ||
          binding.recipient.identifier !== input.recipient.identifier
        ) {
          continue;
        }
        const grantedAt = iso(row.created_at, "consent grant time");
        const revokedAt = row.revoked_at ? iso(row.revoked_at, "consent revocation time") : null;
        const expired =
          binding.expiresAt !== null && Date.parse(binding.expiresAt) <= Date.parse(evaluatedAt);
        return decision(input, {
          consentId: row.id,
          expiresAt: binding.expiresAt,
          grantedAt,
          revokedAt,
          status: row.status === "revoked" || revokedAt ? "revoked" : expired ? "expired" : "active"
        });
      }
      return decision(input, {
        consentId: MISSING_CONSENT_ID,
        expiresAt: null,
        grantedAt: evaluatedAt,
        revokedAt: null,
        status: "missing"
      });
    });
  }
}

function sourceSnapshot(
  row: SourceRow,
  sourceVersion: number,
  notes: readonly NoteRow[],
  prescriptions: readonly PrescriptionRow[]
): ClinicalSummarySourceSnapshot {
  return {
    schemaVersion: "clinic-os-fhir-r4-clinical-summary-source-v1",
    sourceVersion,
    tenant: { id: row.tenant_id, displayName: row.tenant_display_name },
    clinic: {
      id: row.clinic_id,
      tenantId: row.tenant_id,
      displayName: row.clinic_display_name
    },
    patient: {
      id: row.patient_id,
      tenantId: row.tenant_id,
      clinicId: row.clinic_id,
      rowVersion: positiveInteger(row.patient_row_version, "patient row version"),
      fullName: row.full_name,
      dateOfBirth: dateOnly(row.date_of_birth),
      gender: row.gender
    },
    encounter: {
      id: row.encounter_id,
      tenantId: row.tenant_id,
      clinicId: row.clinic_id,
      patientId: row.patient_id,
      providerUserId: row.provider_user_id,
      rowVersion: sourceVersion,
      status: row.encounter_status,
      reason: row.reason,
      startedAt: iso(row.started_at, "encounter start"),
      closedAt: row.closed_at ? iso(row.closed_at, "encounter close") : null
    },
    practitioner: {
      id: row.provider_user_id,
      tenantId: row.tenant_id,
      clinicId: row.clinic_id,
      displayName: row.practitioner_display_name
    },
    clinicalNotes: notes.map((note) => ({
      id: note.id,
      encounterId: note.encounter_id,
      patientId: note.patient_id,
      versionNumber: positiveInteger(note.version_number, "clinical note version"),
      status: note.status,
      sections: noteSections(note.content),
      signedAt: iso(note.signed_at, "clinical note signature time"),
      signedByUserId: note.signed_by_user_id,
      signedContentSha256: digestClinicOsJson(note.content).value
    })),
    prescriptions: prescriptions.map((prescription) => ({
      id: prescription.id,
      encounterId: prescription.encounter_id,
      patientId: prescription.patient_id,
      status: "signed" as const,
      medications: medications(prescription.medications),
      notes: prescription.notes,
      signedAt: iso(prescription.signed_at, "prescription signature time"),
      signedByUserId: prescription.signed_by_user_id
    }))
  };
}

function noteSections(value: unknown): Readonly<Record<string, string>> {
  if (!record(value)) throw new Error("Signed clinical note content is invalid.");
  const allowed = [
    "chiefComplaint",
    "history",
    "examination",
    "investigations",
    "diagnosis",
    "treatmentPlan",
    "treatmentPerformed",
    "followUpInstructions"
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => {
      if (!(key in value)) return [];
      const item = value[key];
      if (!bounded(item, 10_000)) {
        throw new Error(`Signed clinical note ${key} is invalid.`);
      }
      return [[key, item] as const];
    })
  );
}

function medications(
  value: unknown
): ClinicalSummarySourceSnapshot["prescriptions"][number]["medications"] {
  if (!Array.isArray(value)) throw new Error("Signed prescription medications are invalid.");
  return value.map((item) => {
    if (
      !record(item) ||
      !bounded(item.name, 256) ||
      !bounded(item.frequency, 256) ||
      !bounded(item.duration, 256)
    ) {
      throw new Error("Signed prescription medication is invalid.");
    }
    for (const [field, maximum] of [
      ["strength", 256],
      ["route", 256],
      ["instructions", 2_000]
    ] as const) {
      if (field in item && !bounded(item[field], maximum)) {
        throw new Error(`Signed prescription medication ${field} is invalid.`);
      }
    }
    return {
      name: item.name,
      frequency: item.frequency,
      duration: item.duration,
      ...(bounded(item.strength, 256) ? { strength: item.strength } : {}),
      ...(bounded(item.route, 256) ? { route: item.route } : {}),
      ...(bounded(item.instructions, 2_000) ? { instructions: item.instructions } : {})
    };
  });
}

function consentBinding(value: unknown): {
  readonly schemaVersion: "clinic-os-interoperability-consent-v1";
  readonly actions: readonly InteroperabilityAction[];
  readonly scope: "encounter_clinical_summary";
  readonly recipient: ClinicalSummaryRecipient;
  readonly expiresAt: string | null;
} | null {
  if (!record(value) || !record(value.interoperability)) return null;
  const binding = value.interoperability;
  if (
    !exactKeys(binding, ["schemaVersion", "actions", "scope", "recipient", "expiresAt"]) ||
    binding.schemaVersion !== "clinic-os-interoperability-consent-v1" ||
    binding.scope !== "encounter_clinical_summary" ||
    !Array.isArray(binding.actions) ||
    binding.actions.length < 1 ||
    binding.actions.length > 2 ||
    !binding.actions.every(
      (action) => action === "clinical_summary_export" || action === "clinical_summary_import"
    ) ||
    !record(binding.recipient) ||
    !exactKeys(binding.recipient, ["type", "identifier"]) ||
    (binding.recipient.type !== "authorized_organization" &&
      binding.recipient.type !== "authorized_system") ||
    !bounded(binding.recipient.identifier, 256) ||
    (binding.expiresAt !== null && typeof binding.expiresAt !== "string")
  ) {
    return null;
  }
  const expiresAt = binding.expiresAt === null ? null : iso(binding.expiresAt, "consent expiry");
  return {
    schemaVersion: binding.schemaVersion,
    actions: [...new Set(binding.actions as InteroperabilityAction[])],
    scope: binding.scope,
    recipient: {
      type: binding.recipient.type,
      identifier: binding.recipient.identifier
    },
    expiresAt
  };
}

function decision(
  input: {
    readonly action: InteroperabilityAction;
    readonly context: AuthenticatedInteroperabilityContext;
    readonly evaluatedAt: string;
    readonly patientId: string;
    readonly recipient: ClinicalSummaryRecipient;
    readonly scope: "encounter_clinical_summary";
  },
  state: Pick<
    InteroperabilityConsentDecision,
    "consentId" | "expiresAt" | "grantedAt" | "revokedAt" | "status"
  >
): InteroperabilityConsentDecision {
  return {
    action: input.action,
    tenantId: input.context.tenantId,
    clinicId: input.context.clinicId,
    patientId: input.patientId,
    evaluatedAt: input.evaluatedAt,
    recipient: { ...input.recipient },
    scope: input.scope,
    ...state
  };
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const normalized = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) throw new Error("Patient birth date is invalid.");
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
