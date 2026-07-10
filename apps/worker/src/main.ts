import { startWorkerObservability } from "./observability-bootstrap.js";
import type { ObservabilityRuntime } from "@clinic-os/observability";

async function main(): Promise<void> {
  let observability: ObservabilityRuntime | undefined;
  try {
    observability = await startWorkerObservability();
    const { runWorker } = await import("./worker-runtime-main.js");
    await runWorker(observability);
  } catch (error) {
    await observability?.shutdown();
    console.error(
      JSON.stringify({ event: "worker.startup.failed", error_code: boundedErrorCode(error) })
    );
    process.exitCode = 1;
  }
}

void main();

function boundedErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,64}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "WORKER_STARTUP_FAILED";
}
