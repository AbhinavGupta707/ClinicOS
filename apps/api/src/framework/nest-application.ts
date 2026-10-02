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
  app.useBodyParser("raw", { limit: "2mb", type: "application/fhir+json" });
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

  class InteroperabilityController {
    fhirCapability(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    abdmCapability(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    exportClinicalSummary(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    importClinicalSummary(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }

    reviewClinicalSummaryImport(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
  }
  Controller()(InteroperabilityController);
  decorateRoute(InteroperabilityController, "fhirCapability", Get("v1/fhir/metadata"));
  decorateRoute(InteroperabilityController, "abdmCapability", Get("v1/abdm/capability"));
  decorateRoute(
    InteroperabilityController,
    "exportClinicalSummary",
    Post("v1/patients/:patientId/encounters/:encounterId/fhir/clinical-summary")
  );
  decorateRoute(
    InteroperabilityController,
    "importClinicalSummary",
    Post("v1/patients/:patientId/fhir/clinical-summary-imports")
  );
  decorateRoute(
    InteroperabilityController,
    "reviewClinicalSummaryImport",
    Post("v1/fhir/clinical-summary-imports/:reconciliationId/review")
  );

  // New daily-workflow routes use the same guarded native pipeline as the migrated features.
  class DailyWorkflowController {
    listCommunicationAppointments(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    listCommunicationThreads(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    getCommunicationThread(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    getCommunicationConfiguration(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    previewCommunicationAppointment(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    executeCommunicationCommand(request: ParsedIncomingRequest, response: ServerResponse) {
      return executeAndSend(pipeline, request, response);
    }
    preparePatientDocument(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }
    issuePatientDocument(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }
    getPatientDocument(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }

    listPatientSourceContexts(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }
    reviewPatientSourceContext(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }
    getPatientMediaAsset(request:ParsedIncomingRequest,response:ServerResponse) { return executeAndSend(pipeline,request,response); }
    createAppointmentImport(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    stageAppointmentObservations(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    sealAppointmentImport(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    listAppointmentImports(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    getAppointmentImport(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    reviewAppointmentObservation(request:ParsedIncomingRequest,response:ServerResponse){return executeAndSend(pipeline,request,response);}
    executeFinancialCommand(request:ParsedIncomingRequest,response:ServerResponse) {return executeAndSend(pipeline,request,response);}
    getFinancialAccount(request:ParsedIncomingRequest,response:ServerResponse) {return executeAndSend(pipeline,request,response);}
    getFinancialDay(request:ParsedIncomingRequest,response:ServerResponse) {return executeAndSend(pipeline,request,response);}
    previewPatientDuplicates(request:ParsedIncomingRequest,response:ServerResponse) {return executeAndSend(pipeline,request,response); }
    listClinicSetup(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    saveClinicSetup(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listClinicAccess(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    saveClinicAccess(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listClinicStaff(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    getPatientDemographics(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientDentalSnapshots(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    getPatientDentalSnapshot(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientEncounters(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientIntakeHistory(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientInstructions(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientTreatmentPlans(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listPatientInvoices(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listUninvoicedPatientProcedures(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listEncounterPrescriptions(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    closeEncounter(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    searchBillingPatients(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listSopTemplates(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listSopSchedules(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listInventoryCheckRuns(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
    listLabReconciliations(request: ParsedIncomingRequest, response: ServerResponse) { return executeAndSend(pipeline,request,response); }
  }
  Controller()(DailyWorkflowController);
  decorateRoute(DailyWorkflowController,"listCommunicationAppointments",Get("v1/communications/threads/:threadId/appointments"));
  decorateRoute(DailyWorkflowController,"listCommunicationThreads",Get("v1/communications/threads"));
  decorateRoute(DailyWorkflowController,"getCommunicationThread",Get("v1/communications/threads/:threadId"));
  decorateRoute(DailyWorkflowController,"getCommunicationConfiguration",Get("v1/communications/configuration"));
  decorateRoute(DailyWorkflowController,"previewCommunicationAppointment",Post("v1/communications/preview"));
  decorateRoute(DailyWorkflowController,"executeCommunicationCommand",Post("v1/communications/commands"));
  decorateRoute(DailyWorkflowController,"preparePatientDocument",Get("v1/patients/:patientId/document-sources/:kind/:sourceId"));
  decorateRoute(DailyWorkflowController,"issuePatientDocument",Post("v1/patients/:patientId/document-sources/:kind/:sourceId/documents"));
  decorateRoute(DailyWorkflowController,"getPatientDocument",Get("v1/patients/:patientId/document-sources/:kind/:sourceId/documents/:documentId"));
  decorateRoute(DailyWorkflowController,"listPatientSourceContexts",Get("v1/patients/:patientId/source-contexts"));
  decorateRoute(DailyWorkflowController,"reviewPatientSourceContext",Post("v1/patients/:patientId/source-contexts/:contextId/reviews"));
  decorateRoute(DailyWorkflowController,"getPatientMediaAsset",Get("v1/patients/:patientId/media/:mediaAssetId"));
  decorateRoute(DailyWorkflowController,"createAppointmentImport",Post("v1/appointment-imports"));
  decorateRoute(DailyWorkflowController,"listAppointmentImports",Get("v1/appointment-imports"));
  decorateRoute(DailyWorkflowController,"getAppointmentImport",Get("v1/appointment-imports/:importId"));
  decorateRoute(DailyWorkflowController,"stageAppointmentObservations",Post("v1/appointment-imports/:importId/rows"));
  decorateRoute(DailyWorkflowController,"sealAppointmentImport",Post("v1/appointment-imports/:importId/seal"));
  decorateRoute(DailyWorkflowController,"reviewAppointmentObservation",Post("v1/appointment-imports/:importId/rows/:rowId/review"));
  decorateRoute(DailyWorkflowController,"executeFinancialCommand",Post("v1/financial-operations"));
  decorateRoute(DailyWorkflowController,"getFinancialAccount",Get("v1/patients/:patientId/financial-account"));
  decorateRoute(DailyWorkflowController,"getFinancialDay",Get("v1/financial-day"));
  decorateRoute(DailyWorkflowController,"previewPatientDuplicates",Post("v1/patients/duplicate-review"));
  decorateRoute(DailyWorkflowController,"listClinicSetup",Get("v1/clinic-setup/:kind"));
  decorateRoute(DailyWorkflowController,"saveClinicSetup",Post("v1/clinic-setup/:kind"));
  decorateRoute(DailyWorkflowController,"listClinicAccess",Get("v1/clinic-access"));
  decorateRoute(DailyWorkflowController,"saveClinicAccess",Post("v1/clinic-access"));
  decorateRoute(DailyWorkflowController,"listClinicStaff",Get("v1/clinic-staff"));
  decorateRoute(DailyWorkflowController,"getPatientDemographics",Get("v1/patients/:patientId/demographics"));
  decorateRoute(DailyWorkflowController,"listPatientDentalSnapshots",Get("v1/patients/:patientId/dental-snapshots"));
  decorateRoute(DailyWorkflowController,"getPatientDentalSnapshot",Get("v1/patients/:patientId/dental-snapshots/:snapshotId"));
  decorateRoute(DailyWorkflowController,"listPatientEncounters",Get("v1/patients/:patientId/encounters"));
  decorateRoute(DailyWorkflowController,"listPatientIntakeHistory",Get("v1/patients/:patientId/intake-history"));
  decorateRoute(DailyWorkflowController,"listPatientInstructions",Get("v1/patients/:patientId/instructions"));
  decorateRoute(DailyWorkflowController,"listPatientTreatmentPlans",Get("v1/patients/:patientId/treatment-plans"));
  decorateRoute(DailyWorkflowController,"listPatientInvoices",Get("v1/patients/:patientId/invoices"));
  decorateRoute(DailyWorkflowController,"listUninvoicedPatientProcedures",Get("v1/patients/:patientId/uninvoiced-procedures"));
  decorateRoute(DailyWorkflowController,"listEncounterPrescriptions",Get("v1/encounters/:encounterId/prescriptions"));
  decorateRoute(DailyWorkflowController,"closeEncounter",Post("v1/encounters/:encounterId/close"));
  decorateRoute(DailyWorkflowController,"searchBillingPatients",Get("v1/billing/patients"));
  decorateRoute(DailyWorkflowController,"listSopTemplates",Get("v1/sop-templates"));
  decorateRoute(DailyWorkflowController,"listSopSchedules",Get("v1/sop-schedules"));
  decorateRoute(DailyWorkflowController,"listInventoryCheckRuns",Get("v1/inventory/check-runs"));
  decorateRoute(DailyWorkflowController,"listLabReconciliations",Get("v1/lab-reconciliations"));

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
    InteroperabilityController,
    DailyWorkflowController,
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
    contentType.startsWith("text/plain") ? String(result.body) : `${JSON.stringify(result.body)}\n`
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
