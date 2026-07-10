import {
  evaluateBackpressure,
  evaluateReadinessSignals,
  injectW3cTraceContext,
  type BackpressureDecision,
  type BackpressureObservation,
  type InstrumentedOperation,
  type MetricRecorder,
  type ReadinessDecision,
  type ReadinessDependencySignal,
  type TraceCarrier
} from "@clinic-os/observability";
import type {
  OutboxEventHandler,
  OutboxEventRecord,
  OutboxHandlerContext
} from "../outbox/types.js";

export interface WorkerOperationRunner {
  run<T>(operation: InstrumentedOperation, execute: () => Promise<T>): Promise<T>;
}

/** Durable implementations store trace context separately from clinical event payloads. */
export interface OutboxTraceContextStore {
  readonly durability: "durable" | "in_memory_test_double";
  loadForEvent(eventId: string): Promise<TraceCarrier | undefined>;
}

export interface Cp14WorkerObservabilityOptions {
  readonly runner: WorkerOperationRunner;
  readonly metrics: MetricRecorder;
  readonly traceContextStore: OutboxTraceContextStore;
}

export interface Cp14WorkerObservability {
  wrapOutboxHandler<TPayload extends Record<string, unknown>>(
    handler: OutboxEventHandler<TPayload>
  ): OutboxEventHandler<TPayload>;
  runTemporalActivity<T>(
    workflow: WorkerWorkflowFamily,
    execute: () => Promise<T>,
    carrier?: TraceCarrier
  ): Promise<T>;
  observeBackpressure(
    observation: BackpressureObservation,
    dependencies: readonly ReadinessDependencySignal[]
  ): Readonly<{ backpressure: BackpressureDecision; readiness: ReadinessDecision }>;
  outgoingTraceCarrier(): TraceCarrier;
}

export type WorkerWorkflowFamily =
  | "billing"
  | "clinical"
  | "continuity"
  | "front_office"
  | "identity"
  | "media"
  | "operations"
  | "provider"
  | "other";

export function createCp14WorkerObservability(
  options: Cp14WorkerObservabilityOptions
): Cp14WorkerObservability {
  return {
    wrapOutboxHandler<TPayload extends Record<string, unknown>>(
      handler: OutboxEventHandler<TPayload>
    ): OutboxEventHandler<TPayload> {
      return {
        eventType: handler.eventType,
        async handle(
          event: OutboxEventRecord<TPayload>,
          context: OutboxHandlerContext
        ): Promise<void> {
          const carrier = await options.traceContextStore.loadForEvent(event.eventId);
          await options.runner.run(
            {
              domain: "outbox",
              operation: "execute",
              workflow: classifyWorkerWorkflow(event.eventType),
              ...(carrier ? { carrier } : {})
            },
            () => handler.handle(event, context)
          );
        }
      };
    },
    runTemporalActivity<T>(
      workflow: WorkerWorkflowFamily,
      execute: () => Promise<T>,
      carrier?: TraceCarrier
    ): Promise<T> {
      return options.runner.run(
        {
          domain: "temporal",
          operation: "execute",
          workflow,
          ...(carrier ? { carrier } : {})
        },
        execute
      );
    },
    observeBackpressure(
      observation: BackpressureObservation,
      dependencies: readonly ReadinessDependencySignal[]
    ) {
      const backpressure = evaluateBackpressure(observation);
      const readiness = evaluateReadinessSignals(dependencies, backpressure);
      options.metrics.gauge("clinic_os.outbox.depth", observation.queueDepth, {
        status: readiness.state
      });
      options.metrics.gauge("clinic_os.outbox.oldest_age_seconds", observation.oldestAgeSeconds, {
        status: readiness.state
      });
      options.metrics.gauge("clinic_os.backpressure.state", backpressureOrdinal(backpressure), {
        status: backpressure.state
      });
      options.metrics.gauge("clinic_os.readiness", readiness.ready ? 1 : 0, {
        component: "worker",
        status: readiness.state
      });
      return { backpressure, readiness };
    },
    outgoingTraceCarrier: () => injectW3cTraceContext()
  };
}

export function classifyWorkerWorkflow(eventType: string): WorkerWorkflowFamily {
  const normalized = eventType.toLowerCase();
  if (/(?:payment|invoice|billing|receipt)/u.test(normalized)) return "billing";
  if (/(?:encounter|prescription|note|dental|clinical)/u.test(normalized)) return "clinical";
  if (/(?:recall|follow.?up|continuity)/u.test(normalized)) return "continuity";
  if (/(?:lead|patient|appointment|queue|intake)/u.test(normalized)) return "front_office";
  if (/(?:auth|identity|session|mfa|jml)/u.test(normalized)) return "identity";
  if (/(?:media|scan|quarantine)/u.test(normalized)) return "media";
  if (/(?:inventory|lab|sop|task|incident|analytics)/u.test(normalized)) return "operations";
  if (/(?:provider|webhook|message|telephony)/u.test(normalized)) return "provider";
  return "other";
}

function backpressureOrdinal(decision: BackpressureDecision): number {
  if (decision.state === "normal") return 0;
  if (decision.state === "constrained") return 1;
  if (decision.state === "shed_noncritical") return 2;
  return 3;
}
