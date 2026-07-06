import { createServer, type Server, type ServerResponse } from "node:http";
import type { HealthRegistry } from "@clinic-os/observability";

export interface WorkerHealthServerOptions {
  readonly registry: HealthRegistry;
  readonly port: number;
}

export async function startWorkerHealthServer(options: WorkerHealthServerOptions): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (request.url === "/health/live") {
      writeJson(response, 200, {
        status: "healthy",
        checkedAt: new Date().toISOString()
      });
      return;
    }

    if (request.url === "/health/ready") {
      const report = await options.registry.report();
      writeJson(response, report.status === "unhealthy" ? 503 : 200, report);
      return;
    }

    writeJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: "Unknown worker health route"
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
