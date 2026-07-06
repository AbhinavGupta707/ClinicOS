"use client";

import { Button } from "@clinic-os/ui";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { MeProfile } from "@/lib/me";
import { getUnavailableReason, getVisibleSurfaces, summarizeSurfaceAccess } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/roles";

interface ClinicDayProps {
  profile: MeProfile;
  setActiveSurfaceId: (surfaceId: string) => void;
}

const queueRows = [
  {
    label: "Appointments and queue",
    surfaceId: "appointments"
  },
  {
    label: "Lead inbox",
    surfaceId: "lead-inbox"
  },
  {
    label: "Tasks and recalls",
    surfaceId: "tasks"
  },
  {
    label: "Checkout and billing",
    surfaceId: "checkout"
  },
  {
    label: "Lab cases",
    surfaceId: "lab"
  },
  {
    label: "Inventory and SOP",
    surfaceId: "operations"
  }
];

export function ClinicDay({ profile, setActiveSurfaceId }: ClinicDayProps) {
  const visibleSurfaces = getVisibleSurfaces(profile.roles);
  const accessSummary = summarizeSurfaceAccess(profile.roles);
  const visibleById = new Map(visibleSurfaces.map((surface) => [surface.id, surface]));
  const roleList = profile.roles.map((role) => ROLE_LABELS[role]).join(", ");

  return (
    <div className="surface-stack">
      <section className="surface-hero surface-hero--day" aria-labelledby="clinic-day-title">
        <div>
          <p className="eyebrow">Clinic day</p>
          <h1 id="clinic-day-title">{profile.clinic.name}</h1>
          <p className="hero-subline">
            {roleList} access in {profile.tenant.name}
          </p>
        </div>
        <div className="hero-status" aria-label="Shell status">
          <span className="status-dot status-dot--ok" />
          <span>/v1/me connected</span>
        </div>
      </section>

      {profile.source === "dev_fixture" ? (
        <section className="inline-alert" aria-label="Development fixture state">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Local fixture identity</strong>
            <span>Synthetic, non-PHI role context is active for local shell verification.</span>
          </div>
        </section>
      ) : null}

      <section className="readiness-grid" aria-label="Checkpoint 1 readiness">
        <div className="readiness-metric">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Authenticated shell</span>
          <strong>Active</strong>
        </div>
        <div className="readiness-metric">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Visible surfaces</span>
          <strong>{accessSummary.registeredCount}</strong>
        </div>
        <div className="readiness-metric">
          <Clock3 size={18} aria-hidden="true" />
          <span>API-backed queues</span>
          <strong>{accessSummary.unavailableCount}</strong>
        </div>
      </section>

      <section className="work-panel" aria-labelledby="queues-title">
        <div className="panel-heading">
          <div>
            <h2 id="queues-title">Operational queues</h2>
            <p>Surfaces are registered by role; product data waits for the owning API slice.</p>
          </div>
        </div>
        <div className="queue-list">
          {queueRows.map((row) => {
            const surface = visibleById.get(row.surfaceId);

            if (!surface) {
              return null;
            }

            return (
              <div className="queue-row" key={row.surfaceId}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{getUnavailableReason(surface)}</span>
                </div>
                <Button
                  aria-label={`Open ${surface.label}`}
                  className="queue-row__button"
                  icon={<ArrowRight size={16} />}
                  onClick={() => setActiveSurfaceId(surface.id)}
                  size="sm"
                  variant="ghost"
                >
                  Open
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="access-title">
        <div className="panel-heading">
          <div>
            <h2 id="access-title">Access scope</h2>
            <p>Navigation is derived from `/v1/me` role context, not client-side demo state.</p>
          </div>
        </div>
        <div className="surface-table" role="table" aria-label="Visible registered surfaces">
          <div className="surface-row surface-row--head" role="row">
            <span role="columnheader">Surface</span>
            <span role="columnheader">State</span>
            <span role="columnheader">Checkpoint</span>
          </div>
          {visibleSurfaces.map((surface) => (
            <Link
              className="surface-row"
              href={surface.href}
              key={surface.id}
              onClick={() => setActiveSurfaceId(surface.id)}
              role="row"
            >
              <span role="cell">{surface.label}</span>
              <span role="cell">
                {surface.availability === "active" ? "Active" : "Unavailable"}
              </span>
              <span role="cell">{surface.checkpoint}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
