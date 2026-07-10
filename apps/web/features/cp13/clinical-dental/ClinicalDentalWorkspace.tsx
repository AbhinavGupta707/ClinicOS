"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  classifyClinicalCapabilityFailure,
  createLatestClinicalDentalWorkspaceLoader,
  optionalPublicString,
  requestClinicalMediaAccess,
  uploadClinicalMedia,
  type ClinicalCapabilityFailure,
  type ClinicalDentalGeneratedClient,
  type ClinicalDentalWorkspaceData,
  type PublicJsonObject
} from "./loaders";

export interface ClinicalDentalWorkspaceProps {
  readonly client: ClinicalDentalGeneratedClient;
  readonly patientId: string;
  readonly encounterId?: string | null;
}

type WorkspaceState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: ClinicalDentalWorkspaceData }
  | { readonly status: "failed"; readonly failure: ClinicalCapabilityFailure };

export function ClinicalDentalWorkspace(props: ClinicalDentalWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });
  const latestLoader = useMemo(
    () => createLatestClinicalDentalWorkspaceLoader(props.client),
    [props.client]
  );
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await latestLoader.load({
        patientId: props.patientId,
        encounterId: props.encounterId
      });
      if (result.status === "stale") return;
      setState({ status: "ready", data: result.data });
    } catch (error) {
      setState({ status: "failed", failure: classifyClinicalCapabilityFailure(error) });
    }
  }, [latestLoader, props.encounterId, props.patientId]);

  useEffect(() => {
    void load();
    return () => latestLoader.invalidate();
  }, [latestLoader, load]);

  if (state.status === "loading") {
    return (
      <section aria-busy="true" aria-live="polite">
        Loading clinical record…
      </section>
    );
  }
  if (state.status === "failed") {
    return (
      <section role="alert" data-capability-state={state.failure.kind}>
        <h2>Clinical workspace unavailable</h2>
        <p>{state.failure.message}</p>
        {state.failure.requestId ? <p>Request reference: {state.failure.requestId}</p> : null}
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  const consentRecords = state.data.consents.consents;
  const dentalFindings = state.data.dental.findings;
  const mediaAssets = state.data.media.mediaAssets;
  return (
    <section aria-labelledby="clinical-dental-title">
      <header>
        <h2 id="clinical-dental-title">Clinical and dental record</h2>
        <p>Data is loaded from the durable ClinicOS API. There is no fixture fallback.</p>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      <dl>
        <div>
          <dt>Active consents</dt>
          <dd>{activeConsentCount(consentRecords)}</dd>
        </div>
        <div>
          <dt>Dental findings</dt>
          <dd>{dentalFindings.length}</dd>
        </div>
        <div>
          <dt>Media assets</dt>
          <dd>{mediaAssets.length}</dd>
        </div>
        <div>
          <dt>Encounter</dt>
          <dd>
            {state.data.encounter
              ? (optionalPublicString(state.data.encounter.encounter, "status") ?? "Available")
              : "Not selected"}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="dental-findings-title">
        <h3 id="dental-findings-title">Dental findings</h3>
        {dentalFindings.length === 0 ? (
          <p>No findings recorded.</p>
        ) : (
          <ul>
            {dentalFindings.map((finding, index) => (
              <li key={optionalPublicString(finding, "id") ?? `finding-${index}`}>
                Tooth {optionalPublicString(finding, "toothNumber") ?? "not recorded"}:{" "}
                {optionalPublicString(finding, "findingType") ?? "finding"} (
                {optionalPublicString(finding, "reviewStatus") ?? "review pending"})
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClinicalMediaUploadControl
        client={props.client}
        patientId={props.patientId}
        encounterId={props.encounterId}
        onUploaded={() => void load()}
      />

      <section aria-labelledby="clinical-media-title">
        <h3 id="clinical-media-title">Clinical media</h3>
        {mediaAssets.length === 0 ? (
          <p>No media recorded.</p>
        ) : (
          <ul>
            {mediaAssets.map((asset, index) => (
              <li key={optionalPublicString(asset, "id") ?? `media-${index}`}>
                {optionalPublicString(asset, "mediaType") ?? "Clinical media"} —{" "}
                {optionalPublicString(asset, "scanStatus") ?? "scan state unavailable"}
                {optionalPublicString(asset, "id") ? (
                  <ClinicalMediaAccessButton
                    client={props.client}
                    mediaAssetId={optionalPublicString(asset, "id")!}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

export function ClinicalMediaUploadControl(props: {
  readonly client: ClinicalDentalGeneratedClient;
  readonly patientId: string;
  readonly encounterId?: string | null;
  readonly onUploaded?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "unavailable" | "error">(
    "idle"
  );
  const [message, setMessage] = useState(
    "Upload availability is verified when the request starts."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setStatus("error");
      setMessage("Choose a clinical image or document first.");
      return;
    }
    setStatus("uploading");
    setMessage("Uploading through the mediated ClinicOS media route…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await uploadClinicalMedia(props.client, {
        patientId: props.patientId,
        encounterId: props.encounterId,
        mediaType: mediaTypeFor(file.type),
        originalFilename: file.name,
        mimeType: file.type,
        bytes,
        idempotencyKey: crypto.randomUUID()
      });
      setStatus("uploaded");
      setMessage(`Upload recorded with scan state: ${result.scanStatus ?? "pending"}.`);
      props.onUploaded?.();
    } catch (error) {
      const failure = classifyClinicalCapabilityFailure(error);
      setStatus(failure.kind === "unavailable" ? "unavailable" : "error");
      setMessage(failure.message);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-busy={status === "uploading"}>
      <h3>Add clinical media</h3>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,application/dicom"
        onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
      />
      <button type="submit" disabled={status === "uploading"}>
        Upload securely
      </button>
      <p
        role={status === "error" || status === "unavailable" ? "alert" : "status"}
        data-upload-state={status}
      >
        {message}
      </p>
    </form>
  );
}

export function ClinicalMediaAccessButton(props: {
  readonly client: ClinicalDentalGeneratedClient;
  readonly mediaAssetId: string;
}) {
  const [failure, setFailure] = useState<ClinicalCapabilityFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    setFailure(null);
    try {
      const access = await requestClinicalMediaAccess(props.client, {
        mediaAssetId: props.mediaAssetId,
        idempotencyKey: crypto.randomUUID(),
        expiresInSeconds: 300
      });
      window.open(access.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFailure(classifyClinicalCapabilityFailure(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span>
      <button type="button" onClick={() => void open()} disabled={busy}>
        {busy ? "Authorizing…" : "View"}
      </button>
      {failure ? (
        <span role="alert" data-capability-state={failure.kind}>
          {failure.message}
        </span>
      ) : null}
    </span>
  );
}

function activeConsentCount(consents: readonly PublicJsonObject[]): number {
  return consents.filter((consent) => optionalPublicString(consent, "status") === "active").length;
}

function mediaTypeFor(mimeType: string): "intraoral_photo" | "xray" | "document" {
  if (mimeType === "application/dicom") return "xray";
  if (mimeType.startsWith("image/")) return "intraoral_photo";
  return "document";
}
