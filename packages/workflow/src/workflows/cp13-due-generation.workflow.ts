import {
  continueAsNew,
  defineQuery,
  patched,
  proxyActivities,
  setHandler
} from "@temporalio/workflow";
import type { Cp13DueGenerationActivities } from "../activities/cp13-activities.js";
import {
  CP13_ACTIVITY_RETRY_POLICY,
  CP13_DUE_GENERATION_VERSION_MARKER,
  CP13_EVIDENCE_ACTIVITY_RETRY_POLICY,
  CP13_PERMANENT_ACTIVITY_FAILURE,
  type Cp13DueGenerationProgress,
  type Cp13DueGenerationWorkflowInput,
  type Cp13DueGenerationWorkflowResult,
  type Cp13WorkflowFailure
} from "../cp13-contracts.js";
import {
  advanceCp13DueGeneration,
  createCp13DueGenerationProgress,
  failCp13DueGeneration
} from "../cp13-workflow-state.js";
import { classifyCp13ActivityFailure } from "./cp13-failure.js";

const generationActivities = proxyActivities<
  Pick<Cp13DueGenerationActivities, "generateContinuityDueBatch" | "generateSopDueBatch">
>({
  startToCloseTimeout: "2 minutes",
  retry: {
    ...CP13_ACTIVITY_RETRY_POLICY,
    nonRetryableErrorTypes: [CP13_PERMANENT_ACTIVITY_FAILURE]
  }
});

const evidenceActivities = proxyActivities<
  Pick<Cp13DueGenerationActivities, "recordCp13DueGenerationTerminal">
>({
  startToCloseTimeout: "60 seconds",
  retry: CP13_EVIDENCE_ACTIVITY_RETRY_POLICY
});

export const cp13DueGenerationProgressQuery = defineQuery<Cp13DueGenerationProgress>(
  "cp13.due_generation.progress"
);

export async function durableContinuityDueGenerationWorkflow(
  input: Cp13DueGenerationWorkflowInput
): Promise<Cp13DueGenerationWorkflowResult> {
  return runDueGenerationWorkflow(input, "continuity", (nextInput) =>
    continueAsNew<typeof durableContinuityDueGenerationWorkflow>(nextInput)
  );
}

export async function durableSopDueGenerationWorkflow(
  input: Cp13DueGenerationWorkflowInput
): Promise<Cp13DueGenerationWorkflowResult> {
  return runDueGenerationWorkflow(input, "sop", (nextInput) =>
    continueAsNew<typeof durableSopDueGenerationWorkflow>(nextInput)
  );
}

async function runDueGenerationWorkflow(
  input: Cp13DueGenerationWorkflowInput,
  expectedKind: Cp13DueGenerationWorkflowInput["generationKind"],
  continueWith: (input: Cp13DueGenerationWorkflowInput) => Promise<never>
): Promise<Cp13DueGenerationWorkflowResult> {
  patched(CP13_DUE_GENERATION_VERSION_MARKER);
  let progress: Cp13DueGenerationProgress;
  try {
    progress = createCp13DueGenerationProgress(input);
  } catch {
    progress = invalidInputProgress(input, "DUE_GENERATION_INPUT_INVALID");
    const invalidResult = toResult(progress);
    await evidenceActivities.recordCp13DueGenerationTerminal(invalidResult);
    return invalidResult;
  }
  setHandler(cp13DueGenerationProgressQuery, () => progress);

  if (input.generationKind !== expectedKind) {
    progress = failCp13DueGeneration(progress, {
      classification: "permanent",
      code: "DUE_GENERATION_KIND_MISMATCH"
    });
    const mismatchResult = toResult(progress);
    await evidenceActivities.recordCp13DueGenerationTerminal(mismatchResult);
    return mismatchResult;
  }

  while (progress.status === "running") {
    let batch;
    try {
      const request = {
        generationKind: expectedKind,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        asOf: input.asOf,
        batchSize: input.batchSize,
        cursor: progress.cursor,
        eventId: input.eventId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt
      } as const;
      batch =
        expectedKind === "continuity"
          ? await generationActivities.generateContinuityDueBatch(request)
          : await generationActivities.generateSopDueBatch(request);
    } catch (error) {
      progress = failCp13DueGeneration(progress, classifyCp13ActivityFailure(error));
      break;
    }

    let step;
    try {
      step = advanceCp13DueGeneration(input, progress, batch);
    } catch {
      progress = failCp13DueGeneration(progress, {
        classification: "permanent",
        code: "DUE_GENERATION_ACTIVITY_RESULT_INVALID"
      });
      break;
    }
    progress = step.progress;
    if (step.action === "continue_as_new") {
      return continueWith(step.input);
    }
    if (step.action === "terminal") break;
  }

  const result = toResult(progress);
  await evidenceActivities.recordCp13DueGenerationTerminal(result);
  return result;
}

function toResult(progress: Cp13DueGenerationProgress): Cp13DueGenerationWorkflowResult {
  const failure: Cp13WorkflowFailure | undefined = progress.failureCode
    ? {
        classification: progress.failureClassification ?? "permanent",
        code: progress.failureCode
      }
    : undefined;
  return {
    generationKind: progress.generationKind,
    tenantId: progress.tenantId,
    clinicId: progress.clinicId,
    actorUserId: progress.actorUserId,
    eventId: progress.eventId,
    correlationId: progress.correlationId,
    idempotencyKey: progress.idempotencyKey,
    requestedAt: progress.requestedAt,
    asOf: progress.asOf,
    status: progress.status === "completed" ? "completed" : "failed",
    processedCount: progress.processedCount,
    createdCount: progress.createdCount,
    skippedCount: progress.skippedCount,
    batchCount: progress.batchCount,
    continueAsNewCount: progress.continueAsNewCount,
    terminalCursor: progress.cursor,
    ...(failure ? { failure } : {})
  };
}

function invalidInputProgress(
  input: Cp13DueGenerationWorkflowInput,
  failureCode: string
): Cp13DueGenerationProgress {
  return {
    generationKind: input.generationKind,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    eventId: input.eventId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    requestedAt: input.requestedAt,
    asOf: input.asOf,
    batchSize: input.batchSize,
    status: "failed",
    cursor: input.cursor,
    processedCount: 0,
    createdCount: 0,
    skippedCount: 0,
    batchCount: 0,
    continueAsNewCount: 0,
    failureClassification: "permanent",
    failureCode
  };
}
