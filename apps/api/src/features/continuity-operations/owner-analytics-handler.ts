import { buildOwnerDashboardProjection } from "@clinic-os/domain";
import { assertOwnerAnalyticsRange, ownerAnalyticsFreshness } from "@clinic-os/domain";
import {
  appendAudit,
  domainValidation,
  ok,
  optionalStringValue,
  requestQuery,
  type ContinuityOperationsHandler
} from "./shared.ts";

export const getOwnerDashboardHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const observedAt = context.clock.now();
  const defaultDate = observedAt.toISOString().slice(0, 10);
  const from = dateBoundary(optionalStringValue(query.from) ?? defaultDate, "start");
  const to = dateBoundary(optionalStringValue(query.to) ?? defaultDate, "end");
  domainValidation(() => assertOwnerAnalyticsRange(from, to));

  const data = await context.repositories.clinicOperations.loadOwnerDashboardProjectionData({
    startAt: from,
    endAt: to
  });
  const dashboard = buildOwnerDashboardProjection({
    from,
    to,
    generatedAt: observedAt.toISOString(),
    data
  });
  const freshness = ownerAnalyticsFreshness({
    generatedAt: dashboard.generatedAt,
    observedAt,
    dataSources: dashboard.dataSources
  });

  await appendAudit(request, context, {
    action: "owner_dashboard.viewed",
    resourceType: "owner_dashboard",
    resourceId: request.access.clinicId,
    metadata: {
      from,
      to,
      sourceKeys: dashboard.dataSources.map((source) => source.key),
      sourceStatuses: dashboard.dataSources.map((source) => ({
        key: source.key,
        status: source.status
      })),
      freshnessStatus: freshness.status
    },
    occurredAt: observedAt.toISOString()
  });

  return ok({
    dashboard: {
      ...dashboard,
      freshness
    }
  });
};

function dateBoundary(value: string, boundary: "start" | "end"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return boundary === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Parsed owner analytics date was not a valid ISO value.");
  }
  return new Date(timestamp).toISOString();
}
