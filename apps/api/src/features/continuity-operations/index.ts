import type { ClinicFeatureOperationHandler } from "../contracts.ts";
import { CP13_CONTINUITY_OPERATIONS_OPERATION_IDS } from "../cp13-operation-ownership.ts";
import {
  createRecallRuleHandler,
  createSopScheduleHandler,
  createSopTemplateHandler,
  createTaskHandler,
  generateDueContinuityTasksHandler,
  generateDueSopRunsHandler,
  listRecallsHandler,
  listSopRunsHandler,
  listTasksHandler,
  recordRecallActionHandler,
  updateSopRunHandler,
  updateTaskHandler
} from "./continuity-handlers.ts";
import {
  createCorrectiveActionHandler,
  createIncidentHandler,
  createInventoryCategoryHandler,
  createInventoryCheckRunHandler,
  createInventoryCheckTemplateHandler,
  createInventoryItemHandler,
  createLabCaseHandler,
  createLabReconciliationHandler,
  createLabVendorHandler,
  createStockLedgerEntryHandler,
  listCorrectiveActionsHandler,
  listIncidentsHandler,
  listInventoryCategoriesHandler,
  listInventoryCheckTemplatesHandler,
  listInventoryExceptionsHandler,
  listInventoryItemsHandler,
  listLabCasesHandler,
  listLabVendorsHandler,
  updateCorrectiveActionHandler,
  updateInventoryCheckRunHandler,
  updateLabCaseHandler
} from "./clinic-operations-handlers.ts";
import { getOwnerDashboardHandler } from "./owner-analytics-handler.ts";
import type { ContinuityOperationsOperationId } from "./types.ts";

export type ContinuityOperationsHandlerMap = Readonly<
  Record<
    ContinuityOperationsOperationId,
    ClinicFeatureOperationHandler<ContinuityOperationsOperationId>
  >
>;

const CONTINUITY_OPERATIONS_HANDLERS = Object.freeze({
  getOwnerDashboard: getOwnerDashboardHandler,
  listTasks: listTasksHandler,
  createTask: createTaskHandler,
  updateTask: updateTaskHandler,
  generateDueContinuityTasks: generateDueContinuityTasksHandler,
  createRecallRule: createRecallRuleHandler,
  listRecalls: listRecallsHandler,
  recordRecallAction: recordRecallActionHandler,
  createSopTemplate: createSopTemplateHandler,
  createSopSchedule: createSopScheduleHandler,
  listSopRuns: listSopRunsHandler,
  generateDueSopRuns: generateDueSopRunsHandler,
  updateSopRun: updateSopRunHandler,
  listLabVendors: listLabVendorsHandler,
  createLabVendor: createLabVendorHandler,
  listLabCases: listLabCasesHandler,
  createLabCase: createLabCaseHandler,
  updateLabCase: updateLabCaseHandler,
  createLabReconciliation: createLabReconciliationHandler,
  listInventoryCategories: listInventoryCategoriesHandler,
  createInventoryCategory: createInventoryCategoryHandler,
  listInventoryItems: listInventoryItemsHandler,
  createInventoryItem: createInventoryItemHandler,
  createStockLedgerEntry: createStockLedgerEntryHandler,
  listInventoryCheckTemplates: listInventoryCheckTemplatesHandler,
  createInventoryCheckTemplate: createInventoryCheckTemplateHandler,
  createInventoryCheckRun: createInventoryCheckRunHandler,
  updateInventoryCheckRun: updateInventoryCheckRunHandler,
  listInventoryExceptions: listInventoryExceptionsHandler,
  listIncidents: listIncidentsHandler,
  createIncident: createIncidentHandler,
  listCorrectiveActions: listCorrectiveActionsHandler,
  createCorrectiveAction: createCorrectiveActionHandler,
  updateCorrectiveAction: updateCorrectiveActionHandler
} satisfies ContinuityOperationsHandlerMap);

assertExactHandlerCoverage(CONTINUITY_OPERATIONS_HANDLERS);

export function createContinuityOperationsHandlerMap(): ContinuityOperationsHandlerMap {
  return CONTINUITY_OPERATIONS_HANDLERS;
}

export { CONTINUITY_OPERATIONS_HANDLERS };
export type { ContinuityOperationsOperationId } from "./types.ts";

function assertExactHandlerCoverage(map: ContinuityOperationsHandlerMap): void {
  const expected = [...CP13_CONTINUITY_OPERATIONS_OPERATION_IDS].sort();
  const actual = Object.keys(map).sort();
  if (
    expected.length !== actual.length ||
    expected.some((operation, index) => operation !== actual[index])
  ) {
    throw new Error(
      "Continuity/operations handler map does not exactly cover its frozen operations."
    );
  }
}
