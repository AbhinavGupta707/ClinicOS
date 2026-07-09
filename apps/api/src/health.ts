export type ApiRepositoryMode = "postgres" | "fixture" | "injected";
export type ApiAuthMode = "keycloak_jwks" | "local_synthetic_fixture";

export interface ApiDependencyProbe {
  name: string;
  required: boolean;
  timeoutMs?: number;
  check(): Promise<void>;
}

export interface ApiDependencyStatus {
  name: string;
  required: boolean;
  status: "ready" | "unavailable";
  code?: "probe_failed" | "probe_timeout";
}

export interface ApiHealthReport {
  status: "ready" | "unavailable";
  service: "clinic-os-api";
  repository_mode: ApiRepositoryMode;
  auth_mode: ApiAuthMode;
  evidence_tier: "E2_fixture" | "E3_durable" | "unverified_injected";
  dependencies: ApiDependencyStatus[];
}

export class ApiHealthMonitor {
  readonly #repositoryMode: ApiRepositoryMode;
  readonly #authMode: ApiAuthMode;
  readonly #probes: readonly ApiDependencyProbe[];
  #startupComplete = false;
  #startupDependencies: ApiDependencyStatus[] = [];

  constructor(input: {
    repositoryMode: ApiRepositoryMode;
    authMode: ApiAuthMode;
    probes?: readonly ApiDependencyProbe[];
  }) {
    this.#repositoryMode = input.repositoryMode;
    this.#authMode = input.authMode;
    this.#probes = input.probes?.length
      ? input.probes
      : input.repositoryMode === "fixture"
        ? [
            {
              name: "fixture_repository",
              required: true,
              check: () => Promise.resolve()
            }
          ]
        : [
            {
              name: "dependency_probe_registration",
              required: true,
              check: () => Promise.reject(new Error("No dependency probes are registered."))
            }
          ];
  }

  async readiness(): Promise<ApiHealthReport> {
    const dependencies = await Promise.all(this.#probes.map((probe) => runProbe(probe)));
    const ready = dependencies.every(
      (dependency) => !dependency.required || dependency.status === "ready"
    );
    return this.#report(ready ? "ready" : "unavailable", dependencies);
  }

  async startup(): Promise<ApiHealthReport> {
    if (this.#startupComplete) return this.#report("ready", this.#startupDependencies);
    const report = await this.readiness();
    if (report.status === "ready") {
      this.#startupComplete = true;
      this.#startupDependencies = report.dependencies;
    }
    return report;
  }

  async ensureStartup(): Promise<boolean> {
    return (await this.startup()).status === "ready";
  }

  async admitTraffic(): Promise<boolean> {
    if (!this.#startupComplete) return this.ensureStartup();
    return (await this.readiness()).status === "ready";
  }

  #report(status: ApiHealthReport["status"], dependencies: ApiDependencyStatus[]): ApiHealthReport {
    return {
      status,
      service: "clinic-os-api",
      repository_mode: this.#repositoryMode,
      auth_mode: this.#authMode,
      evidence_tier:
        this.#repositoryMode === "postgres"
          ? "E3_durable"
          : this.#repositoryMode === "fixture"
            ? "E2_fixture"
            : "unverified_injected",
      dependencies
    };
  }
}

async function runProbe(probe: ApiDependencyProbe): Promise<ApiDependencyStatus> {
  const timeoutMs = Math.min(Math.max(probe.timeoutMs ?? 1500, 50), 5000);
  let timeout;
  try {
    await Promise.race([
      probe.check(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs);
      })
    ]);
    return { name: probe.name, required: probe.required, status: "ready" };
  } catch (error) {
    return {
      name: probe.name,
      required: probe.required,
      status: "unavailable",
      code: error instanceof ProbeTimeoutError ? "probe_timeout" : "probe_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

class ProbeTimeoutError extends Error {}
