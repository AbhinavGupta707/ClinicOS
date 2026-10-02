"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  classifyClinicalCapabilityFailure,
  optionalPublicString,
  requestClinicalMediaAccess,
  privateUploadSubmissionFilename,
  uploadClinicalMedia,
  type ClinicalCapabilityFailure,
  type ClinicalDentalGeneratedClient,
  type ClinicalMediaUploadResult,
  type PublicJsonObject
} from "./loaders";
import {
  fileContext,
  fileMimeAllowed,
  declaredFileMime,
  type PatientFileType,
  type UploadFileType
} from "./patient-files";

export interface ClinicalDentalWorkspaceProps {
  readonly client: ClinicalDentalGeneratedClient;
  readonly patientId: string;
  readonly encounterId?: string | null;
  readonly canRead: boolean;
  readonly canUpload: boolean;
  readonly locked: boolean;
  readonly mutate: <T>(
    run: (key: string) => Promise<T>,
    after?: (result: T) => Promise<void> | void
  ) => Promise<boolean>;
}

export function ClinicalDentalWorkspace(props: ClinicalDentalWorkspaceProps) {
  const [filter, setFilter] = useState<PatientFileType | "">("");
  const [revision, setRevision] = useState(0);
  return (
    <section className="workspace-card" aria-label="Patient files">
      <h2>Patient files</h2>
      <p>
        Documents and images remain source records. Uploading does not turn them into signed
        ClinicOS notes.
      </p>
      {props.canUpload ? (
        <ClinicalMediaUploadControl
          {...props}
          onUploaded={() => setRevision((value) => value + 1)}
        />
      ) : null}
      {props.canRead ? (
        <>
          <label>
            File type filter{" "}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as PatientFileType | "")}
            >
              <option value="">All files</option>
              <option value="document">Documents</option>
              <option value="xray">X-rays</option>
              <option value="intraoral_photo">Intraoral photos</option>
              <option value="audio_chunk">Audio</option>
              <option value="generated_document">Generated documents</option>
            </select>
          </label>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Refresh files
          </button>
          <MediaList
            key={`${props.patientId}:${filter}:${revision}`}
            client={props.client}
            patientId={props.patientId}
            filter={filter}
          />
        </>
      ) : (
        <p>This account cannot list patient files.</p>
      )}
    </section>
  );
}

function MediaList(props: {
  client: ClinicalDentalGeneratedClient;
  patientId: string;
  filter: PatientFileType | "";
}) {
  const [items, setItems] = useState<readonly PublicJsonObject[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState("");
  const generation = useRef(0);
  const loading = useRef(false);
  const load = useCallback(
    async (after?: string) => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      setFailure("");
      const current = ++generation.current;
      try {
        const page = await props.client.listPatientMediaAssets({
          path: { patientId: props.patientId },
          query: { limit: 50, cursor: after, mediaType: props.filter || undefined }
        });
        if (current !== generation.current) return;
        if (
          page.mediaAssets.some(
            (asset) => optionalPublicString(asset, "patientId") !== props.patientId
          )
        )
          throw new Error("The returned files do not match this patient.");
        setItems((previous) =>
          after
            ? [
                ...previous,
                ...page.mediaAssets.filter((asset) => !previous.some((old) => old.id === asset.id))
              ]
            : page.mediaAssets
        );
        setCursor(page.nextCursor);
      } catch (error) {
        if (current === generation.current)
          setFailure(classifyClinicalCapabilityFailure(error).message);
      } finally {
        if (current === generation.current) {
          loading.current = false;
          setBusy(false);
        }
      }
    },
    [props.client, props.patientId, props.filter]
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
      loading.current = false;
    };
  }, [load]);
  return (
    <div aria-busy={busy}>
      {failure ? (
        <p role="alert">
          {failure} <button onClick={() => void load(cursor ?? undefined)}>Retry files</button>
        </p>
      ) : null}
      {busy ? <p role="status">Loading files…</p> : null}
      {!busy && !failure && !items.length ? <p>No files match this patient and filter.</p> : null}
      <ul>
        {items.map((asset) => (
          <li key={optionalPublicString(asset, "id")!}>
            <ClinicalFileDetails asset={asset} />
            <ClinicalMediaAccessButton
              client={props.client}
              mediaAssetId={optionalPublicString(asset, "id")!}
              asset={asset}
            />
          </li>
        ))}
      </ul>
      {cursor ? (
        <button disabled={busy} onClick={() => void load(cursor)}>
          Load older files
        </button>
      ) : items.length && !busy ? (
        <p>All matching files loaded ({items.length}).</p>
      ) : null}
    </div>
  );
}

export function ClinicalFileDetails({ asset }: { asset: PublicJsonObject }) {
  const context = fileContext(asset);
  return (
    <div className="patient-file-detail">
      <strong>{(optionalPublicString(asset, "mediaType") ?? "File").replaceAll("_", " ")}</strong>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{context.source ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Date on source record</dt>
          <dd>{context.recordDate ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{optionalPublicString(asset, "uploadedAt") ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Scan</dt>
          <dd>{optionalPublicString(asset, "scanStatus") ?? "Unavailable"}</dd>
        </div>
        {asset.toothNumber ? (
          <div>
            <dt>FDI tooth</dt>
            <dd>{String(asset.toothNumber)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function ClinicalMediaUploadControl(
  props: ClinicalDentalWorkspaceProps & { readonly onUploaded?: () => void }
) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<UploadFileType>("document");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [tooth, setTooth] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const preparingRef = useRef(false);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparingRef.current || props.locked) return;
    const mimeType = file ? declaredFileMime(file) : "";
    if (
      !file ||
      file.size < 1 ||
      file.size > 100 * 1024 * 1024 ||
      !fileMimeAllowed(type, mimeType)
    ) {
      setMessage("Choose a supported file for this type, between 1 byte and 100 MiB.");
      return;
    }
    if (!source.trim() || source.trim().length > 120) {
      setMessage("Enter the clinic or system that supplied this file (up to 120 characters).");
      return;
    }
    if (tooth && !/^(?:[1-4][1-8]|[5-8][1-5])$/.test(tooth)) {
      setMessage("Enter a valid FDI tooth number or leave it empty.");
      return;
    }
    try {
      privateUploadSubmissionFilename(file.name, mimeType);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Choose a supported filename.");
      return;
    }
    const selected = file;
    const metadata = {
      patientId: props.patientId,
      encounterId: props.encounterId,
      mediaType: type,
      originalFilename: selected.name,
      mimeType,
      toothNumber: tooth || undefined,
      provenance: { clinicalFile: { source: source.trim(), recordDate: date || null } }
    };
    preparingRef.current = true;
    setPreparing(true);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await selected.arrayBuffer());
    } catch {
      if (active.current)
        setMessage("The file could not be read. Select it again or choose another file.");
      return;
    } finally {
      preparingRef.current = false;
      if (active.current) setPreparing(false);
    }
    if (!active.current) return;
    setMessage("Uploading. If the response is interrupted, use Retry same request above.");
    await props.mutate(
      async (key) => uploadClinicalMedia(props.client, { ...metadata, bytes, idempotencyKey: key }),
      (result: ClinicalMediaUploadResult) => {
        setMessage(`File recorded. Scan: ${result.scanStatus ?? "pending"}.`);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        props.onUploaded?.();
      }
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Add patient file">
      <h3>Add patient file</h3>
      <fieldset disabled={props.locked || preparing}>
        <label>
          File kind{" "}
          <select value={type} onChange={(event) => setType(event.target.value as UploadFileType)}>
            <option value="document">Document</option>
            <option value="xray">X-ray</option>
            <option value="intraoral_photo">Intraoral photo</option>
          </select>
        </label>
        <label>
          Clinical file{" "}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff,image/heic,image/heif,application/pdf,application/dicom"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
            required
          />
        </label>
        <label>
          Source clinic or system{" "}
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          Date on source record, if known{" "}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          FDI tooth, if applicable{" "}
          <input
            value={tooth}
            onChange={(event) => setTooth(event.target.value)}
            maxLength={2}
            inputMode="numeric"
          />
        </label>
        <p>
          Leave unknown dates blank. The upload date is recorded separately. Do not include a
          patient name in the source label.
        </p>
        <button type="submit">Upload securely</button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

export function ClinicalMediaAccessButton(props: {
  readonly client: ClinicalDentalGeneratedClient;
  readonly mediaAssetId: string;
  readonly asset?: PublicJsonObject;
}) {
  const [failure, setFailure] = useState<ClinicalCapabilityFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<{ signedUrl: string; expiresAt: string } | null>(null);
  const allowed =
    props.asset &&
    ["clean", "not_required"].includes(optionalPublicString(props.asset, "scanStatus") ?? "") &&
    !["deleted", "quarantined", "scan_failed"].includes(
      optionalPublicString(props.asset, "status") ?? ""
    );
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setAccess(null);
    setFailure(null);
    setBusy(false);
    return () => {
      generation.current += 1;
    };
  }, [props.mediaAssetId, allowed]);
  useEffect(() => {
    if (!access) return;
    const timer = setTimeout(
      () => setAccess(null),
      Math.max(0, Date.parse(access.expiresAt) - Date.now())
    );
    return () => clearTimeout(timer);
  }, [access]);
  async function open() {
    if (!allowed) return;
    const current = ++generation.current;
    setBusy(true);
    setFailure(null);
    setAccess(null);
    try {
      const result = await requestClinicalMediaAccess(props.client, {
        mediaAssetId: props.mediaAssetId,
        idempotencyKey: crypto.randomUUID(),
        expiresInSeconds: 300
      });
      if (current === generation.current) setAccess(result);
    } catch (error) {
      if (current === generation.current) setFailure(classifyClinicalCapabilityFailure(error));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <div>
      {allowed ? (
        <button type="button" onClick={() => void open()} disabled={busy}>
          {busy ? "Authorizing…" : "Prepare file access"}
        </button>
      ) : (
        <p>Content unavailable until scanning clears this file.</p>
      )}
      {access && allowed ? (
        <p>
          <a href={access.signedUrl} target="_blank" rel="noopener noreferrer">
            Open authorized file
          </a>{" "}
          · Access expires {access.expiresAt}
        </p>
      ) : null}
      {failure ? <p role="alert">{failure.message}</p> : null}
    </div>
  );
}
