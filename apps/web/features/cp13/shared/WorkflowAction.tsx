"use client";

import { useEffect, useMemo, useState } from "react";
import { ClinicOsApiError } from "@clinic-os/api-client-generated";

export interface WorkflowCommand {
  readonly hasPending: () => boolean;
  readonly isRunning: () => boolean;
  readonly pendingLabel: () => string | null;
  readonly execute: <T>(run: (key: string) => Promise<T>, label?: string) => Promise<T>;
  readonly recover: () => Promise<unknown> | null;
}

export function workflowProblem(error: unknown): { message: string; uncertain: boolean } {
  if (error instanceof ClinicOsApiError) {
    if (error.status === 409 && error.details.reason === "idempotency_request_in_progress") {
      return {
        message: "The request is still processing. Retry the same request shortly.",
        uncertain: true
      };
    }
    if (error.status === 409 && error.details.reason === "if_match_failed") {
      return {
        message: "This record changed elsewhere. Refresh it before making another change.",
        uncertain: false
      };
    }
    if (error.status === 401 || error.status === 403) {
      return { message: "This account is not permitted to make that change.", uncertain: false };
    }
    if (error.status < 500) return { message: error.message, uncertain: false };
  }
  return {
    message: "The outcome is not confirmed. Retry the same request before making another change.",
    uncertain: true
  };
}

export function createWorkflowCommand(): WorkflowCommand {
  let pending: { key: string; run: (key: string) => Promise<unknown>; label: string } | null = null;
  let inFlight: Promise<unknown> | null = null;
  const execute = <T,>(
    run: (key: string) => Promise<T>,
    label = "this clinic workflow"
  ): Promise<T> => {
    if (inFlight) return inFlight as Promise<T>;
    pending ??= { key: crypto.randomUUID(), run, label };
    const action = pending;
    inFlight = Promise.resolve()
      .then(() => action.run(action.key))
      .then((result) => {
        pending = null;
        return result;
      })
      .catch((error: unknown) => {
        if (!workflowProblem(error).uncertain) pending = null;
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight as Promise<T>;
  };
  return {
    hasPending: () => pending !== null,
    isRunning: () => inFlight !== null,
    pendingLabel: () => pending?.label ?? null,
    execute,
    recover: () => (pending ? execute(pending.run) : null)
  };
}

let activeScope: string | null = null;
let scopedCommand = createWorkflowCommand();
export function workflowCommandForScope(scope: string): WorkflowCommand {
  if (scope !== activeScope) {
    activeScope = scope;
    scopedCommand = createWorkflowCommand();
  }
  return scopedCommand;
}

export function useWorkflowAction(scope: string, label?: string) {
  const command = useMemo(() => workflowCommandForScope(scope), [scope]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(command.hasPending());

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!command.hasPending()) return;
      event.preventDefault();
    };
    const blockNavigation = (event: MouseEvent) => {
      if (!command.hasPending() || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      setMessage("Resolve the current request before changing patient or leaving this workflow.");
    };
    document.addEventListener("click", blockNavigation, true);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", blockNavigation, true);
    };
  }, [command]);

  async function execute<T>(
    run: (key: string) => Promise<T>,
    after?: (result: T) => Promise<void> | void
  ) {
    if (busy || command.isRunning() || command.hasPending()) {
      setMessage("Resolve the previous request before starting another change.");
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await command.execute(run, label);
      setPending(false);
      setMessage("Saved successfully.");
      try {
        await after?.(result);
      } catch {
        setMessage("Saved successfully. Refresh failed; reload the record before another change.");
      }
      return true;
    } catch (error) {
      setPending(command.hasPending());
      setMessage(workflowProblem(error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function recover(after?: (result: unknown) => Promise<void> | void) {
    if (!command.hasPending() || command.isRunning() || busy) return;
    setBusy(true);
    try {
      const result = await command.recover();
      setPending(false);
      setMessage("The previous request completed successfully.");
      try {
        await after?.(result);
      } catch {
        setMessage("The previous request completed. Refresh failed; reload the record.");
      }
    } catch (error) {
      setPending(command.hasPending());
      setMessage(workflowProblem(error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    execute,
    recover,
    busy,
    pending,
    pendingLabel: command.pendingLabel(),
    message,
    locked: busy || pending
  };
}

export function WorkflowAction(props: {
  readonly message: string;
  readonly pending: boolean;
  readonly pendingLabel?: string | null;
  readonly busy: boolean;
  readonly onRecover: () => void;
}) {
  if (!props.message && !props.pending) return null;
  return (
    <div role="status" aria-live="polite">
      {props.message ? <p>{props.message}</p> : null}
      {props.pending && props.pendingLabel ? (
        <p>
          Unresolved request for {props.pendingLabel}. Retrying uses that original record and the
          original inputs.
        </p>
      ) : null}
      {props.pending ? (
        <button type="button" disabled={props.busy} onClick={props.onRecover}>
          Retry previous request
        </button>
      ) : null}
    </div>
  );
}
