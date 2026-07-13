import { randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server, type ServerResponse } from "node:http";
import {
  All,
  Catch,
  Controller,
  Get,
  Post,
  Req,
  Res,
  type ArgumentsHost,
  type ExceptionFilter,
  Module
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import type { ClinicOsNestRuntime } from "./contracts.ts";
import { sendCentralizedError } from "./error-mapping.ts";
import { ClinicOsRequestPipeline, type PipelineResponse } from "./pipeline.ts";
import type { ParsedIncomingRequest } from "./request-utils.ts";

export interface ClinicOsNestApplication {
  app: NestExpressApplication;
  pipeline: ClinicOsRequestPipeline;
}

export type ClinicOsNestApplicationFactory = (
  runtime: ClinicOsNestRuntime,
  adapter: ExpressAdapter
) => Promise<ClinicOsNestApplication>;

export async function createClinicOsNestApplication(
  runtime: ClinicOsNestRuntime,
  adapter = new ExpressAdapter()
): Promise<ClinicOsNestApplication> {
  const pipeline = new ClinicOsRequestPipeline(runtime);
  const controllers = createControllers(pipeline);
  class ClinicOsApiModule {}
  Module({ controllers })(ClinicOsApiModule);

  const app = await NestFactory.create<NestExpressApplication>(ClinicOsApiModule, adapter, {
    abortOnError: false,
    bodyParser: false,
    logger: false,
    rawBody: true
  });
  app.useBodyParser("raw", {
    limit: "1mb",
    type: (request: { originalUrl?: string; url?: string }) =>
      /^\/v1\/provider-callbacks\/(?:meta-whatsapp|razorpay)\/[A-Za-z0-9_-]{16,128}$/u.test(
        new URL(request.originalUrl ?? request.url ?? "/", "http://clinic-os.local").pathname
      )
  });
  app.useBodyParser("raw", { limit: "100mb", type: "application/octet-stream" });
  app.useBodyParser("json", { limit: "1mb", strict: true, type: "application/json" });
  app.useGlobalFilters(new ClinicOsBoundaryExceptionFilter());
  await app.init();
  return { app, pipeline };
}

export function createClinicOsNestCompatibilityServer(
  runtime: ClinicOsNestRuntime,
  applicationFactory: ClinicOsNestApplicationFactory = createClinicOsNestApplication
): Server {
  const adapter = new ExpressAdapter();
  const expressRequestListener = adapter.getInstance() as RequestListener;
  const application = applicationFactory(runtime, adapter).then(
    (value) => ({ success: true as const, value }),
    (error: unknown) => ({ success: false as const, error })
  );
  let teardownPromise: Promise<void> | undefined;
  const teardown = () => {
    teardownPromise ??= application.then(async (result) => {
      await Promise.all([
        ...(result.success ? [result.value.app.close()] : []),
        ...(runtime.close ? [runtime.close()] : [])
      ]);
    });
    return teardownPromise;
  };
  const server = createServer((request, response) => {
    void application.then((result) => {
      if (result.success) expressRequestListener(request, response);
      else sendCentralizedError(request, response, result.error, randomUUID());
    });
  });
  const nativeListen = server.listen;
  server.listen = ((...args: unknown[]) => {
    void application.then((result) => {
      if (result.success) Reflect.apply(nativeListen, server, args);
      else {
        void teardown().then(
          () => server.emit("error", result.error),
          () => server.emit("error", result.error)
        );
      }
    });
    return server;
  }) as Server["listen"];
  const nativeClose = server.close;
  server.close = ((callback?: (error?: Error) => void) => {
    Reflect.apply(nativeClose, server, [
      (serverError?: Error) => {
        void teardown().then(
          () => callback?.(serverError),
          (teardownError: unknown) =>
            callback?.(
              serverError ??
                (teardownError instanceof Error
                  ? teardownError
                  : new Error("ClinicOS API teardown failed."))
            )
        );
      }
    ]);
    return server;
  }) as Server["close"];
  server.once("close", () => {
    void teardown().catch(() => undefined);
  });
  return server;
}

function createControllers(pipeline: ClinicOsRequestPipeline): Array<new () => object> {
  class HealthController {
    live(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    ready(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    startup(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
  }
  Controller()(HealthController);
  decorateRoute(HealthController, "live", Get("health/live"));
  decorateRoute(HealthController, "ready", Get("health/ready"));
  decorateRoute(HealthController, "startup", Get("health/startup"));

  class IdentityController {
    current(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
  }
  Controller()(IdentityController);
  decorateRoute(IdentityController, "current", Get("v1/me"));

  class ProviderCallbackController {
    metaChallenge(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    metaWebhook(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    razorpay(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
  }
  Controller()(ProviderCallbackController);
  decorateRoute(
    ProviderCallbackController,
    "metaChallenge",
    Get("v1/provider-callbacks/meta-whatsapp/:registrationKey")
  );
  decorateRoute(
    ProviderCallbackController,
    "metaWebhook",
    Post("v1/provider-callbacks/meta-whatsapp/:registrationKey")
  );
  decorateRoute(
    ProviderCallbackController,
    "razorpay",
    Post("v1/provider-callbacks/razorpay/:registrationKey")
  );

  class LegacyStranglerController {
    all(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
  }
  Controller()(LegacyStranglerController);
  decorateRoute(LegacyStranglerController, "all", All("{*path}"));

  return [
    HealthController,
    IdentityController,
    ProviderCallbackController,
    LegacyStranglerController
  ];
}

function decorateRoute(
  controller: new () => object,
  methodName: string,
  methodDecorator: MethodDecorator
): void {
  const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, methodName);
  if (!descriptor) throw new Error(`Missing Nest controller method: ${methodName}`);
  methodDecorator(controller.prototype, methodName, descriptor);
  Req()(controller.prototype, methodName, 0);
  Res()(controller.prototype, methodName, 1);
}

async function executeAndSend(
  pipeline: ClinicOsRequestPipeline,
  request: ParsedIncomingRequest,
  response: ServerResponse
): Promise<void> {
  const result = await pipeline.execute(request);
  sendPipelineResponse(response, result);
}

function sendPipelineResponse(response: ServerResponse, result: PipelineResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  const contentType = result.headers["content-type"] ?? "application/json; charset=utf-8";
  response.end(
    contentType.startsWith("text/plain")
      ? String(result.body)
      : `${JSON.stringify(result.body)}\n`
  );
}

class ClinicOsBoundaryExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ParsedIncomingRequest>();
    const response = http.getResponse<ServerResponse>();
    sendCentralizedError(request, response, error, randomUUID());
  }
}
Catch()(ClinicOsBoundaryExceptionFilter);
