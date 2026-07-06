"use client";

import { Button } from "@clinic-os/ui";
import { RefreshCw } from "lucide-react";

import type { MeProblem } from "@/lib/me";

const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLINIC_OS_SIGN_IN_URL;

interface AuthStatusPanelProps {
  onRetry: () => void;
  problem: MeProblem;
  status: "unauthenticated" | "unavailable";
}

export function AuthStatusPanel({ onRetry, problem, status }: AuthStatusPanelProps) {
  const title = status === "unauthenticated" ? "Authentication required" : "ClinicOS shell unavailable";
  const codeLabel = problem.status ? `${problem.code} / HTTP ${problem.status}` : problem.code;

  return (
    <main className="boot-screen">
      <section className="state-panel" aria-labelledby="auth-state-title">
        <p className="state-kicker">Checkpoint 1 access boundary</p>
        <h1 id="auth-state-title">{title}</h1>
        <p>{problem.message}</p>
        {problem.detail ? <p className="state-detail">{problem.detail}</p> : null}
        <dl className="state-diagnostics">
          <div>
            <dt>First check</dt>
            <dd>/v1/me registration, API dev server, and Keycloak/OIDC activation</dd>
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
          {SIGN_IN_URL && status === "unauthenticated" ? (
            <a className="button-link button-link--primary" href={SIGN_IN_URL}>
              Open identity provider
            </a>
          ) : null}
          <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
            Retry
          </Button>
        </div>
      </section>
    </main>
  );
}
