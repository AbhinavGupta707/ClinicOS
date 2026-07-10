import type { Clock } from "@clinic-os/domain";
import {
  PostgresClinicUnitOfWork,
  type PersistableAuditEvent,
  type SqlConnectionFactory
} from "../postgres.ts";
import type {
  AuditEventSink,
  ClinicOperationsRepository,
  RepositoryScope
} from "../repositories.ts";
import {
  bindApiRequestGuardsPort,
  type ApiRequestGuardsPort,
  type ScopedApiRequestGuardsPort
} from "../api-request-guards.ts";
import { bindAiScribeRepository, type AiScribeRepositoryPort } from "./ai-scribe/index.ts";
import { bindBillingRepository, type BillingRepositoryPort } from "./billing/index.ts";
import {
  bindClinicOperationsRepository,
  type ClinicOperationsRepositoryPort
} from "./clinic-operations/index.ts";
import {
  bindClinicalCareRepository,
  type ClinicalCareRepositoryPort
} from "./clinical-care/index.ts";
import {
  bindClinicalMediaRepository,
  type ClinicalMediaRepositoryPort
} from "./clinical-media/index.ts";
import { bindContinuityRepository, type ContinuityRepositoryPort } from "./continuity/index.ts";
import {
  bindDurableIntegrityRepository,
  type DurableIntegrityRepositoryPort
} from "./durable-integrity/index.ts";
import {
  bindDataIntegrationsRepository,
  type DataIntegrationsRepositoryPort
} from "./data-integrations/index.ts";
import {
  bindDentalTreatmentRepository,
  type DentalTreatmentRepositoryPort
} from "./dental-treatment/index.ts";
import {
  bindPatientAdministrationRepository,
  type PatientAdministrationRepositoryPort
} from "./patient-administration/index.ts";
import {
  bindPrivacySecurityRepository,
  type PrivacySecurityRepositoryPort
} from "./privacy-security/index.ts";
import { bindSchedulingRepository, type SchedulingRepositoryPort } from "./scheduling/index.ts";
import { bindTransactionEvidence, type TransactionEvidencePort } from "./transaction-evidence.ts";
import { createRepositoryPortTransactionLease } from "./core/scoped-repository-port.ts";

export interface ClinicRepositoryModules {
  readonly patientAdministration: PatientAdministrationRepositoryPort;
  readonly scheduling: SchedulingRepositoryPort;
  readonly clinicalCare: ClinicalCareRepositoryPort;
  readonly dentalTreatment: DentalTreatmentRepositoryPort;
  readonly billing: BillingRepositoryPort;
  readonly continuity: ContinuityRepositoryPort;
  readonly clinicOperations: ClinicOperationsRepositoryPort;
  readonly privacySecurity: PrivacySecurityRepositoryPort;
  readonly dataIntegrations: DataIntegrationsRepositoryPort;
  readonly aiScribe: AiScribeRepositoryPort;
  readonly clinicalMedia: ClinicalMediaRepositoryPort;
  /**
   * Additive CP13 production durability seam. Optional at the structural type boundary so legacy
   * fixture contexts remain compilable; production transaction composition always binds it.
   */
  readonly durableIntegrity?: DurableIntegrityRepositoryPort;
}

export interface ClinicModuleTransactionContext {
  readonly repositories: ClinicRepositoryModules;
  readonly evidence: TransactionEvidencePort;
  readonly requestGuards: ApiRequestGuardsPort;
}

export interface ClinicRepositoryUnitOfWorkPort {
  run<TResult>(
    callback: (context: {
      repository: ClinicOperationsRepository;
      auditSink: AuditEventSink<PersistableAuditEvent>;
      requestGuards: ScopedApiRequestGuardsPort;
    }) => Promise<TResult>
  ): Promise<TResult>;
}

export type ClinicModuleScopeResolver<TAuthorizedContext> = (
  authorizedContext: TAuthorizedContext
) => Readonly<RepositoryScope>;

/**
 * Binds one verified request context to all domain ports inside the existing atomic unit of work.
 * The resolver belongs at the authenticated application composition root; command payloads never
 * supply tenant, clinic, or actor authority to repository methods.
 */
export class ClinicModuleUnitOfWork<TAuthorizedContext> {
  readonly #unitOfWork: ClinicRepositoryUnitOfWorkPort;
  readonly #resolveScope: ClinicModuleScopeResolver<TAuthorizedContext>;

  constructor(input: {
    unitOfWork: ClinicRepositoryUnitOfWorkPort;
    resolveScope: ClinicModuleScopeResolver<TAuthorizedContext>;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#resolveScope = input.resolveScope;
  }

  async run<TResult>(
    authorizedContext: TAuthorizedContext,
    callback: (context: ClinicModuleTransactionContext) => Promise<TResult>
  ): Promise<TResult> {
    const scope = normalizeResolvedScope(this.#resolveScope(authorizedContext));

    return this.#unitOfWork.run(async ({ repository, auditSink, requestGuards }) => {
      return runWithClinicModuleTransactionContext(
        { repository, auditSink, requestGuards, scope },
        callback
      );
    });
  }
}

/**
 * Binds the CP12 repository modules to an already-open transaction. CP13 feature handlers use this
 * adapter so idempotency/version guards, domain writes, audit and outbox evidence remain inside the
 * transaction opened by the API mutation coordinator rather than starting a nested unit of work.
 */
export async function runWithClinicModuleTransactionContext<TResult>(
  input: {
    repository: ClinicOperationsRepository;
    auditSink: AuditEventSink<PersistableAuditEvent>;
    requestGuards: ScopedApiRequestGuardsPort;
    scope: Readonly<RepositoryScope>;
  },
  callback: (context: ClinicModuleTransactionContext) => Promise<TResult>
): Promise<TResult> {
  const scope = normalizeResolvedScope(input.scope);
  const lease = createRepositoryPortTransactionLease();

  try {
    const result = await callback({
      repositories: Object.freeze({
        patientAdministration: bindPatientAdministrationRepository(input.repository, scope, lease),
        scheduling: bindSchedulingRepository(input.repository, scope, lease),
        clinicalCare: bindClinicalCareRepository(input.repository, scope, lease),
        dentalTreatment: bindDentalTreatmentRepository(input.repository, scope, lease),
        billing: bindBillingRepository(input.repository, scope, lease),
        continuity: bindContinuityRepository(input.repository, scope, lease),
        clinicOperations: bindClinicOperationsRepository(input.repository, scope, lease),
        privacySecurity: bindPrivacySecurityRepository(input.repository, scope, lease),
        dataIntegrations: bindDataIntegrationsRepository(input.repository, scope, lease),
        aiScribe: bindAiScribeRepository(input.repository, scope, lease),
        clinicalMedia: bindClinicalMediaRepository(input.repository, scope, lease),
        durableIntegrity: bindDurableIntegrityRepository(input.repository, scope, lease)
      }),
      evidence: bindTransactionEvidence(input.repository, input.auditSink, scope, lease),
      requestGuards: bindApiRequestGuardsPort(input.requestGuards, scope, lease)
    });
    await lease.close();
    return result;
  } catch (error) {
    try {
      await lease.close();
    } catch {
      // Preserve the first domain/database error so the existing error taxonomy is unchanged.
    }
    throw error;
  }
}

/** Production adapter: transaction creation remains owned by the CP11 Postgres unit of work. */
export function createPostgresClinicModuleUnitOfWork<TAuthorizedContext>(input: {
  client: SqlConnectionFactory;
  resolveScope: ClinicModuleScopeResolver<TAuthorizedContext>;
  clock?: Clock;
  dueGenerationCursorSecret?: string;
}): ClinicModuleUnitOfWork<TAuthorizedContext> {
  return new ClinicModuleUnitOfWork({
    unitOfWork: new PostgresClinicUnitOfWork(input.client, {
      clock: input.clock,
      dueGenerationCursorSecret: input.dueGenerationCursorSecret
    }),
    resolveScope: input.resolveScope
  });
}

function normalizeResolvedScope(scope: Readonly<RepositoryScope>): Readonly<RepositoryScope> {
  for (const [name, value] of [
    ["tenantId", scope.tenantId],
    ["clinicId", scope.clinicId],
    ["actorUserId", scope.actorUserId]
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Authorized repository scope requires a non-empty ${name}.`);
    }
  }

  return Object.freeze({
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    actorUserId: scope.actorUserId
  });
}
