"use client";

import { Button } from "@clinic-os/ui";
import { Menu, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AssistantWorkflow, isCp2WorkflowSurface } from "@/components/assistant-workflow";
import { AuthStatusPanel } from "@/components/auth-status-panel";
import { ClinicalWorkflow, isCp3WorkflowSurface } from "@/components/clinical-workflow";
import { SurfaceView } from "@/components/surface-view";
import { loadMe, type MeState } from "@/lib/me";
import {
  canAccessSurface,
  getSurface,
  getVisibleSurfaces
} from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/roles";

interface ClinicShellProps {
  initialSurfaceId: string;
}

type ShellMeState = MeState | { status: "loading" };
type AuthenticatedMeState = Extract<MeState, { status: "authenticated" }>;

function isAuthenticatedState(state: ShellMeState): state is AuthenticatedMeState {
  return state.status === "authenticated";
}

export function ClinicShell({ initialSurfaceId }: ClinicShellProps) {
  const [meState, setMeState] = useState<ShellMeState>({ status: "loading" });
  const [activeSurfaceId, setActiveSurfaceId] = useState(initialSurfaceId);
  const [navOpen, setNavOpen] = useState(false);

  const refreshMe = () => {
    setMeState({ status: "loading" });
    void loadMe().then(setMeState);
  };

  useEffect(() => {
    const controller = new AbortController();

    void loadMe(controller.signal).then(setMeState);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setActiveSurfaceId(initialSurfaceId);
  }, [initialSurfaceId]);

  const activeSurface = getSurface(activeSurfaceId);

  const visibleSurfaces = useMemo(() => {
    if (!isAuthenticatedState(meState)) {
      return [];
    }

    return getVisibleSurfaces(meState.profile.roles);
  }, [meState]);

  if (meState.status === "loading") {
    return <ShellLoading />;
  }

  if (meState.status === "unauthenticated" || meState.status === "unavailable") {
    return (
      <AuthStatusPanel onRetry={refreshMe} problem={meState.problem} status={meState.status} />
    );
  }

  if (!isAuthenticatedState(meState)) {
    return null;
  }

  const profile = meState.profile;
  const roleLabels = profile.roles.map((role) => ROLE_LABELS[role]);

  return (
    <div className="clinic-shell">
      <aside
        className={navOpen ? "clinic-nav clinic-nav--open" : "clinic-nav"}
        aria-label="ClinicOS navigation"
      >
        <div className="nav-brand">
          <Link className="brand-mark" href="/" onClick={() => setActiveSurfaceId("today")}>
            <span className="brand-mark__symbol" aria-hidden="true">
              C
            </span>
            <span>
              <strong>ClinicOS</strong>
              <small>{profile.clinic.name}</small>
            </span>
          </Link>
          <Button
            aria-label="Close navigation"
            className="nav-close"
            icon={<X size={18} />}
            onClick={() => setNavOpen(false)}
            size="sm"
            variant="ghost"
          >
            Close
          </Button>
        </div>

        <nav className="nav-list">
          {visibleSurfaces.map((surface) => {
            const Icon = surface.icon;
            const active = surface.id === activeSurface.id;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "nav-item nav-item--active" : "nav-item"}
                href={surface.href}
                key={surface.id}
                onClick={() => {
                  setActiveSurfaceId(surface.id);
                  setNavOpen(false);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{surface.label}</span>
                {surface.availability !== "active" ? (
                  <span className="nav-status">Later</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="clinic-frame">
        <header className="clinic-topbar">
          <div className="topbar-left">
            <Button
              aria-label="Open navigation"
              className="mobile-menu"
              icon={<Menu size={18} />}
              onClick={() => setNavOpen(true)}
              size="sm"
              variant="ghost"
            >
              Menu
            </Button>
            <div>
              <p className="topbar-kicker">{profile.tenant.name}</p>
              <h2>{activeSurface.label}</h2>
            </div>
          </div>
          <div className="topbar-right">
            <div className="role-chips" aria-label="Current roles">
              {roleLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <Button
              aria-label="Refresh session context"
              icon={<RefreshCw size={16} />}
              onClick={refreshMe}
              size="sm"
              variant="secondary"
            >
              Refresh
            </Button>
          </div>
        </header>

        <main className="clinic-main" id="clinic-main">
          {!canAccessSurface(activeSurface, profile.roles) ? (
            <SurfaceView profile={profile} surface={activeSurface} />
          ) : isCp2WorkflowSurface(activeSurface.id) ? (
            <AssistantWorkflow
              activeSurfaceId={activeSurface.id}
              profile={profile}
              setActiveSurfaceId={setActiveSurfaceId}
            />
          ) : isCp3WorkflowSurface(activeSurface.id) ? (
            <ClinicalWorkflow
              activeSurfaceId={activeSurface.id}
              profile={profile}
              setActiveSurfaceId={setActiveSurfaceId}
            />
          ) : (
            <SurfaceView profile={profile} surface={activeSurface} />
          )}
        </main>
      </div>
    </div>
  );
}

function ShellLoading() {
  return (
    <main className="boot-screen" aria-busy="true" aria-live="polite">
      <section className="state-panel">
        <p className="state-kicker">Opening ClinicOS</p>
        <h1>Checking session context</h1>
        <div className="skeleton-line skeleton-line--short" />
        <div className="skeleton-line" />
        <div className="skeleton-grid">
          <div />
          <div />
          <div />
        </div>
      </section>
    </main>
  );
}
