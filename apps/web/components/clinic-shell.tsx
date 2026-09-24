"use client";

import { Button } from "@clinic-os/ui";
import {
  CalendarDays,
  CheckCircle2,
  Leaf,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  UsersRound,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiReviewWorkflow, isCp8WorkflowSurface } from "@/components/ai-review-workflow";
import { AssistantWorkflow, isCp2WorkflowSurface } from "@/components/assistant-workflow";
import { AuthStatusPanel } from "@/components/auth-status-panel";
import { CheckoutWorkflow, isCp5WorkflowSurface } from "@/components/checkout-workflow";
import { ClinicalWorkflow, isCp3WorkflowSurface } from "@/components/clinical-workflow";
import { DentalMediaWorkflow, isCp4WorkflowSurface } from "@/components/dental-media-workflow";
import {
  IntegrationOpsWorkflow,
  isCp7WorkflowSurface
} from "@/components/integration-ops-workflow";
import { isCp6WorkflowSurface, OperationsWorkflow } from "@/components/operations-workflow";
import {
  isCp10PilotReadinessSurface,
  PilotReadinessWorkflow
} from "@/components/pilot-readiness-workflow";
import { SurfaceView } from "@/components/surface-view";
import { Cp13Workspace } from "@/features/cp13/Cp13Workspace";
import { isCp13WorkspaceSurface } from "@/features/cp13/runtime-helpers";
import { SESSION_INVALIDATED_EVENT, signOut, usesStaffSession } from "@/lib/staff-session";
import { loadMe, type MeState } from "@/lib/me";
import {
  canAccessSurface,
  getSurface,
  getSurfaceStateLabel,
  getVisibleSurfaces,
  type SurfaceRegistration
} from "@/lib/navigation";
import {
  clearPatientNavigationHandoff,
  patientNavigationHandoffMatchesIdentity,
  readPatientNavigationHandoff,
  rememberPatientNavigation,
  type PatientNavigationHandoff
} from "@/lib/patient-navigation-handoff";
import { ROLE_LABELS } from "@/lib/roles";

interface ClinicShellProps {
  initialSurfaceId: string;
}

type ShellMeState = MeState | { status: "loading" };
type AuthenticatedMeState = Extract<MeState, { status: "authenticated" }>;

function isAuthenticatedState(state: ShellMeState): state is AuthenticatedMeState {
  return state.status === "authenticated";
}

const NAVIGATION_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly surfaceIds: readonly string[];
}> = [
  { label: "Today", surfaceIds: ["today"] },
  { label: "Patients", surfaceIds: ["patients", "patient-profile", "intake", "consent"] },
  { label: "Schedule", surfaceIds: ["appointments", "returning-prep", "encounter"] },
  { label: "Inbox", surfaceIds: ["lead-inbox", "tasks"] },
  {
    label: "Operations",
    surfaceIds: [
      "checkout",
      "lab",
      "operations",
      "integrations",
      "migration-review",
      "owner-control"
    ]
  }
];

function groupNavigationSurfaces(surfaces: readonly SurfaceRegistration[]) {
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const groupedIds = new Set(NAVIGATION_GROUPS.flatMap((group) => group.surfaceIds));
  const groups = NAVIGATION_GROUPS.map((group) => ({
    label: group.label,
    surfaces: group.surfaceIds.flatMap((surfaceId) => {
      const surface = surfaceById.get(surfaceId);
      return surface ? [surface] : [];
    })
  })).filter((group) => group.surfaces.length > 0);
  const remaining = surfaces.filter((surface) => !groupedIds.has(surface.id));
  return remaining.length > 0 ? [...groups, { label: "More", surfaces: remaining }] : groups;
}

export function ClinicShell({ initialSurfaceId }: ClinicShellProps) {
  const router = useRouter();
  const [meState, setMeState] = useState<ShellMeState>({ status: "loading" });
  const [activeSurfaceId, setActiveSurfaceId] = useState(initialSurfaceId);
  const [navOpen, setNavOpen] = useState(false);
  const [patientHandoff, setPatientHandoff] = useState<PatientNavigationHandoff | null>(() =>
    readPatientNavigationHandoff()
  );

  const activeLoad = useRef<AbortController | null>(null);
  const sessionClosed = useRef(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const refreshMe = useCallback(() => {
    if (sessionClosed.current) return;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setMeState({ status: "loading" });
    void loadMe(controller.signal).then((state) => {
      if (!controller.signal.aborted && !sessionClosed.current) setMeState(state);
    }).catch(() => undefined); // Aborted older requests must not restore a previous identity.
  }, []);

  useEffect(() => {
    refreshMe();
    const invalidate = () => {
      activeLoad.current?.abort();
      clearPatientNavigationHandoff(); setPatientHandoff(null);
      setMeState({ status: "unauthenticated", problem: { code: "AUTH_REQUIRED", message: "Sign in to continue." } });
    };
    const onFocus = () => { if (usesStaffSession()) refreshMe(); };
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    window.addEventListener("focus", onFocus);
    return () => {
      activeLoad.current?.abort();
      window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshMe]);

  const endSession = async () => {
    sessionClosed.current = true;
    setSigningOut(true); setSignOutError(null);
    // Remove patient content immediately, including when the provider is unavailable.
    activeLoad.current?.abort(); clearPatientNavigationHandoff(); setPatientHandoff(null);
    setMeState({ status: "loading" });
    try {
      const result = await signOut();
      setMeState({ status: "unauthenticated", problem: { code: "AUTH_REQUIRED", message: result === "provider_unconfirmed"
        ? "Your ClinicOS session is closed. Identity-provider sign-out could not be confirmed. Close this window or sign out directly with your identity provider."
        : "Your ClinicOS session is closed." } });
    } catch {
      setSignOutError("Sign-out could not be fully confirmed. Retry when the identity service is available.");
      setMeState({ status: "unavailable", problem: { code: "SERVER_ERROR", message: "Sign-out could not be fully confirmed." } });
    } finally { setSigningOut(false); }
  };

  useEffect(() => {
    setActiveSurfaceId(initialSurfaceId);
  }, [initialSurfaceId]);

  useEffect(() => {
    if (meState.status === "authenticated") {
      const handoff = readPatientNavigationHandoff();
      if (
        handoff &&
        !patientNavigationHandoffMatchesIdentity(
          handoff,
          meState.profile.tenant.id,
          meState.profile.clinic.id,
          meState.profile.user.id
        )
      ) {
        clearPatientNavigationHandoff();
        setPatientHandoff(null);
      }
      return;
    }

    if (meState.status !== "loading") {
      clearPatientNavigationHandoff();
      setPatientHandoff(null);
    }
  }, [meState]);

  const activeSurface = getSurface(activeSurfaceId);

  const visibleSurfaces = useMemo(() => {
    if (!isAuthenticatedState(meState)) {
      return [];
    }

    return getVisibleSurfaces(meState.profile.roles);
  }, [meState]);

  const navigationGroups = useMemo(
    () => groupNavigationSurfaces(visibleSurfaces),
    [visibleSurfaces]
  );

  if (meState.status === "loading") {
    return <ShellLoading />;
  }

  if (meState.status === "unauthenticated" || meState.status === "unavailable") {
    return (
      <AuthStatusPanel onRetry={signOutError ? () => void endSession() : sessionClosed.current ? undefined : refreshMe} problem={meState.problem} status={meState.status} />
    );
  }

  if (!isAuthenticatedState(meState)) {
    return null;
  }

  const profile = meState.profile;
  const roleLabels = profile.roles.map((role) => ROLE_LABELS[role]);
  const selectedPatientId =
    patientHandoff &&
    patientNavigationHandoffMatchesIdentity(
      patientHandoff,
      profile.tenant.id,
      profile.clinic.id,
      profile.user.id
    )
      ? patientHandoff.patientId
      : null;
  const rememberSelectedPatient = (patientId: string) => {
    setPatientHandoff(
      rememberPatientNavigation(profile.tenant.id, profile.clinic.id, profile.user.id, patientId)
    );
  };

  return (
    <div className="clinic-shell">
      <aside
        className={navOpen ? "clinic-nav clinic-nav--open" : "clinic-nav"}
        aria-label="ClinicOS navigation"
      >
        <div className="nav-brand">
          <Link className="brand-mark" href="/" onClick={() => setActiveSurfaceId("today")}>
            <strong>ClinicOS</strong>
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
          {navigationGroups.map((group) => (
            <section className="nav-section" key={group.label} aria-label={group.label}>
              <p className="nav-section__label">{group.label}</p>
              {group.surfaces.map((surface) => {
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
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span>{surface.label}</span>
                    {surface.availability !== "active" ? (
                      <span className="nav-status" title={getSurfaceStateLabel(surface)}>
                        Unavailable
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>

        <footer className="nav-profile">
          <span aria-hidden="true">{profile.user.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{profile.user.displayName}</strong>
            <small>{roleLabels[0] ?? "Clinic team"}</small>
          </div>
        </footer>
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
            <div className="clinic-context">
              <Leaf size={22} strokeWidth={1.65} aria-hidden="true" />
              <strong>{profile.clinic.name}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <div className="session-freshness" aria-label="Clinic session status">
              <CheckCircle2 size={17} strokeWidth={1.75} aria-hidden="true" />
              <span>Clinic session active</span>
            </div>
            <Button
              aria-label="Refresh session context"
              icon={<RefreshCw size={16} />}
              onClick={refreshMe}
              size="sm"
              variant="ghost"
            >
              <span className="sr-only">Refresh</span>
            </Button>
            {usesStaffSession() ? <Button size="sm" variant="ghost" disabled={signingOut} onClick={() => void endSession()}>
              Sign out
            </Button> : null}
            <Link
              className="button-link button-link--primary topbar-action"
              href="/surface/appointments"
            >
              <Plus size={17} strokeWidth={1.75} aria-hidden="true" />
              New appointment
            </Link>
            <Link className="button-link topbar-action" href="/surface/patients">
              <Search size={17} strokeWidth={1.75} aria-hidden="true" />
              Find patient
            </Link>
          </div>
        </header>

        <main className="clinic-main" id="clinic-main">
          {!canAccessSurface(activeSurface, profile.roles) ? (
            <SurfaceView profile={profile} surface={activeSurface} />
          ) : isCp13WorkspaceSurface(activeSurface.id) ? (
            <Cp13Workspace
              activeSurfaceId={activeSurface.id}
              key={[profile.tenant.id, profile.clinic.id, profile.user.id, activeSurface.id].join(":")}
              onOpenPatient={(patientId) => {
                rememberSelectedPatient(patientId);
                setActiveSurfaceId("patients");
                router.push("/surface/patients");
              }}
              onOpenPatientProfile={(patientId) => {
                rememberSelectedPatient(patientId);
                setActiveSurfaceId("patient-profile");
                router.push("/surface/patient-profile");
              }}
              onSelectPatient={rememberSelectedPatient}
              profile={profile}
              selectedPatientId={selectedPatientId}
            />
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
          ) : isCp4WorkflowSurface(activeSurface.id) ? (
            <DentalMediaWorkflow profile={profile} />
          ) : isCp5WorkflowSurface(activeSurface.id) ? (
            <CheckoutWorkflow profile={profile} />
          ) : isCp6WorkflowSurface(activeSurface.id) ? (
            <OperationsWorkflow activeSurfaceId={activeSurface.id} profile={profile} />
          ) : isCp7WorkflowSurface(activeSurface.id) ? (
            <IntegrationOpsWorkflow activeSurfaceId={activeSurface.id} profile={profile} />
          ) : isCp8WorkflowSurface(activeSurface.id) ? (
            <AiReviewWorkflow activeSurfaceId={activeSurface.id} profile={profile} />
          ) : isCp10PilotReadinessSurface(activeSurface.id) ? (
            <PilotReadinessWorkflow />
          ) : (
            <SurfaceView profile={profile} surface={activeSurface} />
          )}
        </main>

        <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
          <Link aria-current={activeSurface.id === "today" ? "page" : undefined} href="/">
            <CalendarDays size={21} strokeWidth={1.75} aria-hidden="true" />
            <span>Today</span>
          </Link>
          <Link
            aria-current={activeSurface.id === "patients" ? "page" : undefined}
            href="/surface/patients"
          >
            <UsersRound size={21} strokeWidth={1.75} aria-hidden="true" />
            <span>Patients</span>
          </Link>
          <Link
            aria-current={activeSurface.id === "appointments" ? "page" : undefined}
            href="/surface/appointments"
          >
            <CalendarDays size={21} strokeWidth={1.75} aria-hidden="true" />
            <span>Schedule</span>
          </Link>
          <Link
            aria-current={activeSurface.id === "lead-inbox" ? "page" : undefined}
            href="/surface/lead-inbox"
          >
            <Search size={21} strokeWidth={1.75} aria-hidden="true" />
            <span>Inbox</span>
          </Link>
          <button onClick={() => setNavOpen(true)} type="button">
            <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
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
