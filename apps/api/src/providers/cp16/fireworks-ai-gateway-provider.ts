import { createHash } from "node:crypto";
import type { AdapterCapability, ProviderHealth } from "@clinic-os/integrations";
import {
  AiGatewayProviderError,
  type AiGatewayDraftRequest,
  type AiGatewayDraftResult,
  type AiGatewayProvider,
  type FireworksGatewayPort
} from "@clinic-os/integrations";
import { Cp16AiApplicationError, type Cp16AiService } from "../../features/cp16-ai/index.ts";

/** Adapts the hardened CP16 Fireworks workflow to the existing review-only scribe operation. */
export class FireworksAiGatewayProvider implements AiGatewayProvider {
  readonly providerKey = "fireworks";
  readonly providerMode = "live" as const;
  readonly #gateway: FireworksGatewayPort;
  readonly #service: Cp16AiService;

  constructor(input: { readonly gateway: FireworksGatewayPort; readonly service: Cp16AiService }) {
    this.#gateway = input.gateway;
    this.#service = input.service;
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const readiness = await this.#gateway.readiness();
    return {
      providerKey: this.providerKey,
      status: readiness.operational
        ? "available"
        : readiness.status === "degraded" || readiness.status === "circuit_open"
          ? "degraded"
          : readiness.status === "not_configured"
            ? "not_configured"
            : "unavailable",
      checkedAt: readiness.checkedAt,
      capabilities: [],
      message: `Fireworks CP16 boundary: ${readiness.reasonCode}.`
    };
  }

  async generateDrafts(request: AiGatewayDraftRequest): Promise<AiGatewayDraftResult> {
    const sourceText = JSON.stringify({
      schemaVersion: "clinic-os-ai-scribe-source-v1",
      sessionId: request.sessionId,
      transcriptSegments: [...request.segments]
        .sort((left, right) => left.sequence - right.sequence)
        .map((segment) => ({
          sourceAnchorId:
            request.sourceAnchorIds[
              Math.min(segment.sequence - 1, request.sourceAnchorIds.length - 1)
            ] ?? request.sourceAnchorIds[0],
          sequence: segment.sequence,
          speakerRole: segment.speakerRole,
          text: segment.text,
          startsAtMs: segment.startsAtMs,
          endsAtMs: segment.endsAtMs
        }))
    });
    const estimatedInputTokens = Math.max(1, Math.ceil(Buffer.byteLength(sourceText, "utf8") / 3));
    try {
      const reviewed = await this.#service.createReviewedClinicalDraft({
        tenantId: request.tenantId,
        clinicId: request.clinicId,
        patientId: request.patientId,
        encounterId: request.encounterId,
        actorUserId: request.actorUserId,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        sourceText,
        sourceAnchorIds: request.sourceAnchorIds,
        estimatedInputTokens,
        safetyReviewEstimatedInputTokens: Math.min(8_192, Math.max(1, estimatedInputTokens * 2))
      });
      const artifact = reviewed.draft.artifact;
      const safety = reviewed.independentSafetyReview.artifact;
      const sourceAnchorIds = [
        ...new Set(artifact.evidence.flatMap((item) => item.sourceAnchorIds))
      ];
      const confidence =
        artifact.evidence.reduce((sum, item) => sum + item.confidence, 0) /
        artifact.evidence.length;
      const warnings = boundedUnique([
        ...artifact.warnings,
        ...artifact.uncertainty.reasons,
        ...artifact.safety.concerns,
        ...safety.warnings,
        ...safety.safety.concerns,
        "This Fireworks output is review-only and has not changed the clinical record."
      ]);
      return {
        providerMode: this.providerMode,
        providerKey: this.providerKey,
        providerRequestDigest: sha256(
          `${reviewed.draft.provenance.responseDigest}\0${reviewed.independentSafetyReview.provenance.responseDigest}`
        ),
        clinicalNoteDraft: {
          content: {
            history: artifact.summary,
            assessment: artifact.evidence.map((item) => item.statement).join("\n"),
            confidence,
            requiresDoctorAttention: warnings
          },
          confidence,
          warnings,
          sourceAnchorIds
        },
        dentalChartPatchDraft: {
          content: {
            encounterId: request.encounterId,
            findings: [],
            warnings: [
              "The CP16 generic structured-draft schema does not autonomously create tooth-level findings."
            ]
          },
          confidence: 0,
          warnings: ["Record tooth-level findings manually after reviewing the source transcript."],
          sourceAnchorIds
        },
        actionProposals: []
      };
    } catch (error) {
      if (error instanceof Cp16AiApplicationError) {
        throw new AiGatewayProviderError({
          providerKey: this.providerKey,
          status: error.code === "INVALID_RUNTIME" ? "not_configured" : "unavailable",
          message: error.message,
          details: { reasonCode: error.code }
        });
      }
      throw error;
    }
  }
}

function boundedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].slice(0, 32);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
