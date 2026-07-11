import {
  ObservabilityConfigurationError,
  createObservabilityRuntime,
  isProductionLikeTelemetryEnvironment,
  observabilityConfigurationFromEnvironment,
  type ObservabilityRuntime
} from "@clinic-os/observability";

export async function startWorkerObservability(
  env: NodeJS.ProcessEnv = process.env
): Promise<ObservabilityRuntime> {
  const environment = env.CLINIC_OS_ENV ?? "local";
  const productionLike = isProductionLikeTelemetryEnvironment(environment);
  const runtime = createObservabilityRuntime({
    configuration: observabilityConfigurationFromEnvironment(env, {
      serviceName: "clinic-os-worker",
      serviceVersion: requiredProductionIdentity(
        env.CLINIC_OS_RELEASE_VERSION,
        productionLike,
        "TELEMETRY_SERVICE_VERSION_REQUIRED",
        "local"
      ),
      serviceInstanceId: requiredProductionIdentity(
        env.CLINIC_OS_SERVICE_INSTANCE_ID ?? env.WORKER_ID ?? env.HOSTNAME,
        productionLike,
        "TELEMETRY_SERVICE_INSTANCE_ID_REQUIRED",
        `worker-local-${process.pid}`
      ),
      region: requiredProductionIdentity(
        env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
        productionLike,
        "TELEMETRY_REGION_REQUIRED",
        "local"
      )
    })
  });
  await runtime.start();
  return runtime;
}

function requiredProductionIdentity(
  value: string | undefined,
  productionLike: boolean,
  code: string,
  localFallback: string
): string {
  if (value?.trim()) return value.trim();
  if (productionLike) throw new ObservabilityConfigurationError(code);
  return localFallback;
}
