import type {
  FireworksConsentPolicyDecision,
  FireworksConsentPolicyGate,
  FireworksConsentPolicyRequest
} from "@clinic-os/integrations";
import type {
  Cp16AiProcessingPolicyDecision,
  Cp16AiProcessingPolicyGate,
  Cp16AiProcessingPolicyRequest
} from "../../features/cp16-ai/contracts.ts";
import {
  sha256,
  validInstant,
  uuid,
  withAiScope,
  type Cp16AiUnitOfWork
} from "./postgres-ai-shared.ts";

interface ConsentRow extends Record<string, unknown> {
  readonly encounter_exists: boolean;
  readonly consent_id: string | null;
  readonly consent_status: "active" | "revoked" | null;
  readonly template_code: string | null;
  readonly template_version: number | null;
  readonly evidence: unknown;
  readonly provenance: unknown;
  readonly created_at: string | Date | null;
  readonly revoked_at: string | Date | null;
}

type PolicyRequest = Cp16AiProcessingPolicyRequest | FireworksConsentPolicyRequest;
type PolicyDecision = Cp16AiProcessingPolicyDecision | FireworksConsentPolicyDecision;

/** Rechecks exact encounter ownership and active AI-processing consent before every provider step. */
export class PostgresCp16AiPolicyGate
  implements Cp16AiProcessingPolicyGate, FireworksConsentPolicyGate
{
  readonly #unitOfWork: Cp16AiUnitOfWork;

  constructor(unitOfWork: Cp16AiUnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  evaluate(input: PolicyRequest): Promise<PolicyDecision> {
    if (
      !uuid(input.tenantId) ||
      !uuid(input.clinicId) ||
      !uuid(input.patientId) ||
      !uuid(input.encounterId) ||
      !uuid(input.actorUserId)
    ) {
      return Promise.reject(new Error("AI policy scope is invalid."));
    }
    const evaluatedAt = validInstant(input.evaluatedAt, "policy evaluation");
    return withAiScope(this.#unitOfWork, input, async (client) => {
      const result = await client.query<ConsentRow>(
        `select exists (
                  select 1 from encounters e
                   where e.tenant_id = $1 and e.clinic_id = $2
                     and e.id = $3 and e.patient_id = $4
                     and e.status not in ('cancelled')
                ) as encounter_exists,
                c.id as consent_id, c.status as consent_status,
                c.template_code, c.template_version, c.evidence, c.provenance,
                c.created_at, c.revoked_at
           from (select 1) seed
           left join lateral (
             select * from consents
              where tenant_id = $1 and clinic_id = $2 and patient_id = $4
                and purpose = 'ai_audio_capture'
              order by created_at desc
              limit 1
           ) c on true`,
        [input.tenantId, input.clinicId, input.encounterId, input.patientId]
      );
      const row = result.rows[0];
      const allowed = row?.encounter_exists === true && row.consent_status === "active";
      const reasonCode = !row?.encounter_exists
        ? "encounter_scope_invalid"
        : row.consent_status === "revoked"
          ? "consent_revoked"
          : row.consent_status !== "active"
            ? "consent_missing"
            : "consent_current";
      const stage = "stage" in input ? input.stage : "unknown";
      return Object.freeze({
        allowed,
        reasonCode,
        snapshotDigest: sha256(
          JSON.stringify({
            schemaVersion: "cp16-ai-policy-snapshot-v1",
            tenantId: input.tenantId,
            clinicId: input.clinicId,
            patientId: input.patientId,
            encounterId: input.encounterId,
            actorUserId: input.actorUserId,
            task: input.task,
            stage,
            evaluatedAt,
            encounterExists: row?.encounter_exists === true,
            consentId: row?.consent_id ?? null,
            consentStatus: row?.consent_status ?? null,
            templateCode: row?.template_code ?? null,
            templateVersion: row?.template_version ?? null,
            evidenceDigest: sha256(JSON.stringify(row?.evidence ?? null)),
            provenanceDigest: sha256(JSON.stringify(row?.provenance ?? null)),
            createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
            revokedAt: row?.revoked_at ? new Date(row.revoked_at).toISOString() : null,
            reasonCode
          })
        )
      });
    });
  }
}
