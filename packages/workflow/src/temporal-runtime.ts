import {
  Client,
  Connection,
  type TLSConfig,
  type WorkflowClientInterceptor
} from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  type ActivityInterceptorsFactory,
  type WorkerOptions
} from "@temporalio/worker";
import type { ApprovalActivities } from "./activities/approval-activities.js";
import type { Cp13WorkflowActivities } from "./activities/cp13-activities.js";

export const CLINIC_OS_TASK_QUEUE = "clinic-os-default";
export const CLINIC_OS_NAMESPACE = "default";

export interface TemporalClientOptions {
  readonly address: string;
  readonly namespace?: string;
  readonly tls?: TLSConfig;
  readonly apiKey?: string | (() => string);
  readonly workflowInterceptors?: readonly WorkflowClientInterceptor[];
}

export interface TemporalWorkerRuntimeOptions {
  readonly address: string;
  readonly namespace?: string;
  readonly taskQueue?: string;
  readonly tls?: TLSConfig;
  readonly apiKey?: string;
  readonly activities: Partial<ApprovalActivities> & Cp13WorkflowActivities;
  readonly shutdownGraceTimeMs?: number;
  readonly activityInterceptors?: readonly ActivityInterceptorsFactory[];
}

export async function createTemporalClient(options: TemporalClientOptions): Promise<Client> {
  const connection = await Connection.connect({
    address: options.address,
    ...(options.tls ? { tls: options.tls } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {})
  });
  return new Client({
    connection,
    namespace: options.namespace ?? CLINIC_OS_NAMESPACE,
    ...(options.workflowInterceptors
      ? { interceptors: { workflow: [...options.workflowInterceptors] } }
      : {})
  });
}

export async function createClinicTemporalWorker(
  options: TemporalWorkerRuntimeOptions
): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: options.address,
    ...(options.tls ? { tls: options.tls } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {})
  });
  const workerOptions: WorkerOptions = {
    connection,
    namespace: options.namespace ?? CLINIC_OS_NAMESPACE,
    taskQueue: options.taskQueue ?? CLINIC_OS_TASK_QUEUE,
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities: options.activities,
    interceptors: {
      workflowModules: [new URL("./workflow-trace-interceptor.js", import.meta.url).pathname],
      ...(options.activityInterceptors ? { activity: [...options.activityInterceptors] } : {})
    },
    shutdownGraceTime: options.shutdownGraceTimeMs
      ? `${options.shutdownGraceTimeMs} milliseconds`
      : "30 seconds"
  };

  return Worker.create(workerOptions);
}
