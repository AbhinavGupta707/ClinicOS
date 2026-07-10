import { startApiObservability } from "./observability-bootstrap.ts";
import type { ObservabilityRuntime } from "@clinic-os/observability";

async function main(): Promise<void> {
  let observability: ObservabilityRuntime | undefined;
  try {
    observability = await startApiObservability();
    const { createRuntimeApiNestApplication } = await import("./server.ts");
    const { app, port } = await createRuntimeApiNestApplication(process.env, observability);
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopping ??= app.close().then(() => undefined);
      return stopping;
    };
    process.once("SIGINT", () => void stop().catch(() => undefined));
    process.once("SIGTERM", () => void stop().catch(() => undefined));
    await app.listen(port);
  } catch (error) {
    await observability?.shutdown();
    console.error(
      JSON.stringify({ event: "api.startup.failed", error_code: boundedErrorCode(error) })
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
  return "API_STARTUP_FAILED";
}
