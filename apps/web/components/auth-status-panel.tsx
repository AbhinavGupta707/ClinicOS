"use client";

import { Button } from "@clinic-os/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { MeProblem } from "@/lib/me";



interface AuthStatusPanelProps {
  onRetry?: () => void;
  problem: MeProblem;
  status: "unauthenticated" | "unavailable";
}

export function AuthStatusPanel({ onRetry, problem, status }: AuthStatusPanelProps) {
  const [loginAvailable, setLoginAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/health", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => response.ok && (await response.json()).loginAllowed === true)
      .then((available) => { if (!controller.signal.aborted) setLoginAvailable(available); })
      .catch(() => { if (!controller.signal.aborted) setLoginAvailable(false); });
    return () => controller.abort();
  }, []);
  const title =
    status === "unauthenticated" ? "Sign in to ClinicOS" : "Staff access unavailable";
  const codeLabel = problem.status ? `${problem.code} / HTTP ${problem.status}` : problem.code;

  return (
    <main className="boot-screen">
      <section className="state-panel" aria-labelledby="auth-state-title">
        <p className="state-kicker">Staff access</p>
        <h1 id="auth-state-title">{title}</h1>
        <p>{problem.message}</p>
        {problem.detail ? <p className="state-detail">{problem.detail}</p> : null}
        <dl className="state-diagnostics">
          <div>
            <dt>First check</dt>
            <dd>{problem.code === "CLINIC_SELECTION_REQUIRED"
              ? "Clinic membership and clinic-selection configuration"
              : "Ask your administrator to check staff access and service health"}</dd>
          </div>
          <div>
            <dt>Diagnostic code</dt>
            <dd>{codeLabel}</dd>
          </div>
          {problem.requestId ? (
            <div>
              <dt>Request id</dt>
              <dd>{problem.requestId}</dd>
            </div>
          ) : null}
        </dl>
        <div className="state-actions">
          {loginAvailable ? (
            <a className="button-link button-link--primary" href="/auth/login?returnTo=%2F">
              Sign in to ClinicOS
            </a>
          ) : null}
          {onRetry ? <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
            Retry
          </Button> : null}
        </div>
      </section>
    </main>
  );
}
