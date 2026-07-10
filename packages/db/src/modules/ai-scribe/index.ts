import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const AI_SCRIBE_OPERATIONS = [
  "createAiSession",
  "findAiSessionById",
  "findAiSessionDetail",
  "listAiSessionsForEncounter",
  "createAiTranscriptSegment",
  "createAiSourceAnchor",
  "createAiJob",
  "createAiDraftOutput",
  "createAiActionProposal",
  "recordAiReviewDecision",
  "deleteAiSessionRetainedPayloads"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type AiScribeRepositoryPort = BoundClinicRepositoryPort<
  (typeof AI_SCRIBE_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindAiScribeRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): AiScribeRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, AI_SCRIBE_OPERATIONS, lease);
}
