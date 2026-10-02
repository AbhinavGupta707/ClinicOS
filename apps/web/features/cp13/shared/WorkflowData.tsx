"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
export function useWorkflowData<T>(load: () => Promise<T>, dependencies: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const generation = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    const current = ++generation.current.value;
    setLoading(true);
    setError("");
    try {
      const result = await load();
      if (current === generation.current.value) setData(result);
      return result;
    } catch (cause) {
      if (current === generation.current.value)
        setError(cause instanceof Error ? cause.message : "Data could not be loaded.");
      throw cause;
    } finally {
      if (current === generation.current.value) setLoading(false);
    }
    // Callers provide every stable value captured by the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => {
    const counter = generation.current;
    void refresh().catch(() => undefined);
    return () => {
      counter.value++;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
export function WorkflowCard(props: {
  title: string;
  children: ReactNode;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}) {
  return (
    <section className="workspace-card" aria-label={props.title} aria-busy={props.loading}>
      <header>
        <h2>{props.title}</h2>
        {props.onRefresh ? (
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        ) : null}
      </header>
      {props.loading ? <p role="status">Loading…</p> : null}
      {props.error ? <p role="alert">{props.error}</p> : null}
      {props.children}
    </section>
  );
}
