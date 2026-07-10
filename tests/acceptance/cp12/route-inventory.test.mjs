import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CURRENT_OPERATION_ROUTE_COUNT,
  CURRENT_ROUTE_CONTROL_INVENTORY,
  CURRENT_ROUTE_COUNT
} from "./current-route-control-inventory.mjs";

const serverSource = await readFile(
  new URL("../../../apps/api/src/server.ts", import.meta.url),
  "utf8"
);
const operationsSource = await readFile(
  new URL("../../../apps/api/src/operations.ts", import.meta.url),
  "utf8"
);

test("CP12 inventory covers every current native-router operation registration", () => {
  assert.equal(CURRENT_ROUTE_CONTROL_INVENTORY.length, CURRENT_ROUTE_COUNT);
  assert.equal(CURRENT_ROUTE_COUNT, 128);

  const keys = CURRENT_ROUTE_CONTROL_INVENTORY.map(
    (route) => `${route.method} ${route.pathTemplate}`
  );
  assert.equal(new Set(keys).size, keys.length, "method/path inventory keys must be unique");

  const operationStart = serverSource.indexOf("async function routeOperationsRequest");
  const operationEnd = serverSource.indexOf("async function resolveAccessContext");
  assert.ok(operationStart > 0 && operationEnd > operationStart);
  const operationSource = serverSource.slice(operationStart, operationEnd);
  const registeredHandlers = [...operationSource.matchAll(/return\s+(\w+)\s*\(/g)].map(
    (match) => match[1]
  );
  const inventoriedHandlers = CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (route) => route.routeClass === "authenticated_clinic_operation"
  ).map((route) => route.handler);

  assert.equal(registeredHandlers.length, CURRENT_OPERATION_ROUTE_COUNT);
  assert.deepEqual(inventoriedHandlers, registeredHandlers);
  assert.match(serverSource, /request\.url === "\/v1\/me"/);
  assert.match(serverSource, /request\.url === "\/v1\/payment-webhooks\/razorpay"/);
  for (const healthKind of ["live", "ready", "startup"]) {
    assert.match(serverSource, new RegExp(`request\\.url === "\\/health\\/${healthKind}"`));
  }
});

test("inventory permission claims are grounded in the current operation handlers", () => {
  const exportedFunctions = [...operationsSource.matchAll(/export async function (\w+)\s*\(/g)];
  const functionChunks = new Map();
  for (const [index, match] of exportedFunctions.entries()) {
    const start = match.index;
    const end = exportedFunctions[index + 1]?.index ?? operationsSource.length;
    functionChunks.set(match[1], operationsSource.slice(start, end));
  }
  const dentalHelperStart = operationsSource.indexOf(
    "async function createDentalFindingForPatient"
  );
  const dentalHelperEnd = operationsSource.indexOf("function scopeFrom", dentalHelperStart);
  const dentalHelper = operationsSource.slice(dentalHelperStart, dentalHelperEnd);

  for (const route of CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (candidate) => candidate.routeClass === "authenticated_clinic_operation"
  )) {
    const handlerSource = functionChunks.get(route.handler);
    assert.ok(handlerSource, `missing source for ${route.handler}`);
    const authorizationSource =
      route.handler === "createPatientDentalFinding"
        ? `${handlerSource}\n${dentalHelper}`
        : handlerSource;
    for (const requirement of route.currentControls.permissions) {
      if (requirement === "role:doctor") {
        assert.match(authorizationSource, /authorizeDoctorSignature/);
      } else {
        assert.ok(
          authorizationSource.includes(`"${requirement}"`),
          `${route.handler} source does not establish ${requirement}`
        );
      }
    }
  }
});

test("current inventory exposes bypasses and inconsistencies instead of marking them compliant", () => {
  for (const route of CURRENT_ROUTE_CONTROL_INVENTORY) {
    assert.equal(route.compliantWithCp12Pipeline, false, `${route.method} ${route.pathTemplate}`);
    assert.ok(route.gaps.includes("no_registered_security_policy"));
    assert.ok(route.gaps.includes("no_application_rate_budget"));
    assert.ok(route.gaps.includes("unvalidated_client_request_id"));
    assert.equal(route.currentControls.rateBudget, "absent");
  }

  const health = CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (route) => route.routeClass === "public_health"
  );
  assert.equal(health.length, 3);
  assert.ok(
    health.every((route) => route.currentControls.authentication === "intentionally_public")
  );

  const webhook = CURRENT_ROUTE_CONTROL_INVENTORY.find(
    (route) => route.routeClass === "verified_provider_webhook"
  );
  assert.ok(webhook);
  assert.equal(webhook.currentControls.requestBody, "raw_bytes_before_parse");
  assert.equal(webhook.currentControls.bodyOversizeStatus, 400);
  assert.ok(webhook.gaps.includes("oversize_body_returns_400_not_413"));

  const operations = CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (route) => route.routeClass === "authenticated_clinic_operation"
  );
  assert.equal(operations.length, CURRENT_OPERATION_ROUTE_COUNT);
  assert.ok(operations.every((route) => route.currentControls.permissions.length > 0));
  assert.ok(
    operations
      .filter((route) => ["PATCH", "POST"].includes(route.method))
      .every(
        (route) =>
          route.currentControls.unknownFieldsRejected === false &&
          route.gaps.includes("unknown_body_fields_ignored")
      )
  );
});

test("inventory records body query and pagination control gaps route by route", () => {
  const bodyRoutes = CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (route) => route.currentControls.bodyBudgetBytes !== null
  );
  assert.ok(bodyRoutes.length > 70);
  assert.ok(bodyRoutes.every((route) => route.currentControls.bodyOversizeStatus === 400));

  const queryRoutes = CURRENT_ROUTE_CONTROL_INVENTORY.filter(
    (route) => route.currentControls.queryFields.length > 0
  );
  assert.ok(queryRoutes.length > 20);
  assert.ok(queryRoutes.every((route) => route.currentControls.queryBudget === "absent"));

  const paginationRoutes = queryRoutes.filter((route) =>
    route.currentControls.queryFields.includes("limit")
  );
  assert.ok(paginationRoutes.length >= 6);
  assert.ok(
    paginationRoutes.every(
      (route) => route.currentControls.paginationBudget === "handler_specific_only"
    )
  );
});
