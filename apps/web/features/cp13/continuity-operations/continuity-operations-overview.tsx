import type { ContinuityOperationsLoadState } from "./loader";

export interface ContinuityOperationsOverviewProps {
  readonly state: ContinuityOperationsLoadState;
}

export function ContinuityOperationsOverview({ state }: ContinuityOperationsOverviewProps) {
  if (state.status === "unauthenticated") {
    return (
      <section aria-labelledby="continuity-operations-title" role="alert">
        <h2 id="continuity-operations-title">Continuity and operations</h2>
        <p>Access is unavailable for this clinic role. No operational data was displayed.</p>
      </section>
    );
  }

  if (state.status === "unavailable") {
    return (
      <section aria-labelledby="continuity-operations-title" role="alert">
        <h2 id="continuity-operations-title">Continuity and operations unavailable</h2>
        <p>{state.problem.message}</p>
        {state.problem.requestId ? <p>Request reference: {state.problem.requestId}</p> : null}
      </section>
    );
  }

  const { data } = state;
  return (
    <section aria-labelledby="continuity-operations-title">
      <header>
        <h2 id="continuity-operations-title">Continuity and operations</h2>
        <p>
          Request-time durable data. Analytics rebuild is not applicable because this view is not a
          materialized cache.
        </p>
        {state.status === "stale" ? (
          <p role="status">Analytics is stale; verify the generated time before acting.</p>
        ) : null}
      </header>
      <dl>
        <Metric label="Tasks" value={data.tasks.length} />
        <Metric label="Recalls" value={data.recalls.length} />
        <Metric label="SOP runs" value={data.sopRuns.length} />
        <Metric label="Lab cases" value={data.labCases.length} />
        <Metric label="Inventory items" value={data.inventoryItems.length} />
        <Metric label="Inventory exceptions" value={data.inventoryExceptions.length} />
        <Metric label="Incidents" value={data.incidents.length} />
        <Metric label="Corrective actions" value={data.correctiveActions.length} />
      </dl>
      <p>
        Generated: {data.freshness.generatedAt ?? "Unavailable"}. No procurement, provider delivery,
        payment, or workflow completion is inferred by this summary.
      </p>
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
