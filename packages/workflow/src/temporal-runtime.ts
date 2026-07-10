import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker, type WorkerOptions } from "@temporalio/worker";
import type { ApprovalActivities } from "./activities/approval-activities.js";
import type { Cp13WorkflowActivities } from "./activities/cp13-activities.js";

export const CLINIC_OS_TASK_QUEUE = "clinic-os-default";
export const CLINIC_OS_NAMESPACE = "default";

export interface TemporalClientOptions {
  readonly address: string;
  readonly namespace?: string;
}

export interface TemporalWorkerRuntimeOptions {
  readonly address: string;
  readonly namespace?: string;
  readonly taskQueue?: string;
  readonly activities: ApprovalActivities & Cp13WorkflowActivities;
  readonly shutdownGraceTimeMs?: number;
}

export async function createTemporalClient(options: TemporalClientOptions): Promise<Client> {
  const connection = await Connection.connect({ address: options.address });
  return new Client({
    connection,
    namespace: options.namespace ?? CLINIC_OS_NAMESPACE
  });
}

export async function createClinicTemporalWorker(
  options: TemporalWorkerRuntimeOptions
): Promise<Worker> {
  const connection = await NativeConnection.connect({ address: options.address });
  const workerOptions: WorkerOptions = {
    connection,
    namespace: options.namespace ?? CLINIC_OS_NAMESPACE,
    taskQueue: options.taskQueue ?? CLINIC_OS_TASK_QUEUE,
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities: options.activities,
    shutdownGraceTime: options.shutdownGraceTimeMs
      ? `${options.shutdownGraceTimeMs} milliseconds`
      : "30 seconds"
  };

  return Worker.create(workerOptions);
}
