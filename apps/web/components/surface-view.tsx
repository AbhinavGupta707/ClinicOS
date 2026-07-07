"use client";

import { Button } from "@clinic-os/ui";
import { AlertTriangle, LockKeyhole, PlugZap } from "lucide-react";

import type { MeProfile } from "@/lib/me";
import { canAccessSurface, getUnavailableReason, type SurfaceRegistration } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/roles";

interface SurfaceViewProps {
  profile: MeProfile;
  surface: SurfaceRegistration;
}

export function SurfaceView({ profile, surface }: SurfaceViewProps) {
  const canAccess = canAccessSurface(surface, profile.roles);

  if (!canAccess) {
    return (
      <section
        className="state-panel state-panel--content"
        aria-labelledby="denied-title"
        data-testid={surface.checkpoint === 3 ? "cp3-clinical-access-denied" : undefined}
      >
        <LockKeyhole size={28} aria-hidden="true" />
        <p className="state-kicker">Role boundary</p>
        <h1 id="denied-title">This surface is outside the current role scope.</h1>
        <p>Required roles: {surface.roles.map((role) => ROLE_LABELS[role]).join(", ")}.</p>
      </section>
    );
  }

  if (surface.availability === "active") {
    return (
      <section className="work-panel" aria-labelledby={`${surface.id}-title`}>
        <div className="panel-heading">
          <div>
            <h1 id={`${surface.id}-title`}>{surface.label}</h1>
            <p>{surface.description}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="surface-stack">
      <section className="surface-hero" aria-labelledby={`${surface.id}-title`}>
        <div>
          <p className="eyebrow">Registered surface</p>
          <h1 id={`${surface.id}-title`}>{surface.label}</h1>
          <p className="hero-subline">{surface.description}</p>
        </div>
        <div className="hero-status hero-status--pending" aria-label="Surface state">
          <span className="status-dot status-dot--warn" />
          <span>Unavailable</span>
        </div>
      </section>

      <section className="work-panel" aria-labelledby={`${surface.id}-state-title`}>
        <div className="panel-heading">
          <div>
            <h2 id={`${surface.id}-state-title`}>Activation state</h2>
            <p>{getUnavailableReason(surface)}.</p>
          </div>
        </div>
        <div className="activation-layout">
          <div className="activation-card">
            <PlugZap size={20} aria-hidden="true" />
            <strong>Required API boundary</strong>
            <ul>
              {surface.requiredApis.map((api) => (
                <li key={api}>{api}</li>
              ))}
            </ul>
          </div>
          <div className="activation-card">
            <AlertTriangle size={20} aria-hidden="true" />
            <strong>No product data is rendered</strong>
            <p>
              This shell does not invent clinic queues, patients, clinical records, payments, or
              analytics before the owning API slice exists.
            </p>
          </div>
        </div>
        <div className="surface-actions">
          <Button disabled variant="secondary">
            Awaiting API activation
          </Button>
        </div>
      </section>
    </div>
  );
}
