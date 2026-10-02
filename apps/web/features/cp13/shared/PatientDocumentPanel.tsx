"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClinicOsApiClient,
  PreparePatientDocumentRequest,
  PreparePatientDocumentResponse,
  GetPatientDocumentResponse
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "../../../lib/me";

type Props = PreparePatientDocumentRequest["path"] & {
  client: ClinicOsApiClient;
  profile: MeProfile;
  locked: boolean;
  sourceRevision: string;
  label: string;
  execute: (invoke: (key: string) => Promise<unknown>) => Promise<boolean>;
};
export function PatientDocumentPanel(props: Props) {
  return (
    <DocumentPanel
      key={[
        props.profile.tenant.id,
        props.profile.clinic.id,
        props.profile.user.id,
        props.patientId,
        props.kind,
        props.sourceId
      ].join(":")}
      {...props}
    />
  );
}
function DocumentPanel({
  client,
  patientId,
  kind,
  sourceId,
  sourceRevision,
  locked,
  label,
  execute
}: Props) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [problem, setProblem] = useState("");
  const [page, setPage] = useState<PreparePatientDocumentResponse | null>(null);
  const [copies, setCopies] = useState<PreparePatientDocumentResponse["documents"]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  const [saved, setSaved] = useState<GetPatientDocumentResponse["document"] | null>(null);
  const [frameReady, setFrameReady] = useState(false),
    [loadToken, setLoadToken] = useState(0);
  const [approved, setApproved] = useState(false),
    [archiveAccepted, setArchiveAccepted] = useState(false),
    [notice, setNotice] = useState("");
  const frame = useRef<HTMLIFrameElement>(null),
    generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const read = useCallback(
    async (id: string | null, cursor?: string) => {
      const current = ++generation.current;
      setFrameReady(false);
      setLoadedRevision(null);
      setLoading(true);
      setProblem("");
      setPage(null);
      setSaved(null);
      setApproved(false);
      setArchiveAccepted(false);
      try {
        const path = { patientId, kind, sourceId };
        const next = await client.preparePatientDocument({
          path,
          query: cursor ? { cursor } : undefined
        });
        const document = id
          ? (await client.getPatientDocument({ path: { ...path, documentId: id } })).document
          : null;
        if (document) {
          const digest = Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.html))
            )
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (digest !== document.htmlDigest)
            throw new Error(
              "Document integrity check failed. Reload before printing or downloading."
            );
        }
        if (current !== generation.current || !mounted.current) return;
        setLoadToken(current);
        setLoadedRevision(sourceRevision);
        setPage(next);
        setSaved(document);
        setCopies((previous) =>
          cursor
            ? [...previous, ...next.documents.filter((d) => !previous.some((p) => p.id === d.id))]
            : next.documents
        );
      } catch (error) {
        if (current === generation.current && mounted.current)
          setProblem(
            error instanceof Error ? error.message : "Documents are unavailable. Retry before use."
          );
      } finally {
        if (current === generation.current && mounted.current) setLoading(false);
      }
    },
    [client, patientId, kind, sourceId, sourceRevision]
  );
  useEffect(() => {
    if (open && !locked) void read(selectedId);
    return () => {
      generation.current += 1;
    };
  }, [open, read, selectedId, locked]);
  const generate = async () => {
    if (!page?.preview || !approved || locked || loading || loadedRevision !== sourceRevision)
      return;
    const expectedSourceDigest = page.preview.sourceDigest;
    setNotice("");
    await execute(async (key) => {
      const result = await client.issuePatientDocument({
        path: { patientId, kind, sourceId },
        headers: { "idempotency-key": key },
        body: { expectedSourceDigest }
      });
      if (mounted.current) {
        setSelectedId(result.documentId);
        setNotice(
          result.reused
            ? "The identical saved copy is available."
            : "Generated copy saved. Review it before printing or downloading."
        );
        setApproved(false);
      }
      return result;
    });
  };
  const usable =
    loadedRevision === sourceRevision &&
    frameReady &&
    !!saved &&
    !saved.unavailableReason &&
    (!saved.sourceChanged || archiveAccepted) &&
    !locked &&
    !loading &&
    !problem;
  const download = () => {
    if (!usable || !saved) return;
    const url = URL.createObjectURL(new Blob([saved.html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinicos-${kind}-${saved.id}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Printable HTML download requested. Keep this patient document in clinic-approved storage."
    );
  };
  const print = () => {
    if (!usable) return;
    try {
      if (!frame.current?.contentWindow) throw new Error("Document preview is unavailable.");
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
      setNotice(
        "Print dialog requested. Check every page; printing and handover are not automatically confirmed."
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Printing is unavailable.");
    }
  };
  return (
    <section
      aria-label={`${kind.replaceAll("_", " ")} documents`}
      style={{ minWidth: 0, overflowWrap: "anywhere", marginBlock: 12 }}
    >
      <button type="button" disabled={locked || loading} onClick={() => setOpen((v) => !v)}>
        {open ? "Close document preview" : label}
      </button>
      {open ? (
        <>
          <p>
            Review the saved source, then generate a copy. Download is printable HTML; use Print /
            Save as PDF for a PDF. No document is sent automatically.
          </p>
          <button type="button" disabled={locked || loading} onClick={() => void read(selectedId)}>
            Refresh document source
          </button>
          {loading ? <p role="status">Loading document source…</p> : null}
          {problem ? <p role="alert">{problem}</p> : null}
          {page?.unavailableReason ? <p role="alert">{page.unavailableReason}</p> : null}
          {saved?.unavailableReason ? (
            <p role="alert">
              {saved.unavailableReason} This copy is available for historical inspection only.
            </p>
          ) : null}
          {saved ? (
            <p>
              Saved copy revision {saved.revision} · generated {saved.generatedAt}. This is the
              original content, not a live balance or current clinical status.
            </p>
          ) : null}
          {saved?.sourceChanged && !saved.unavailableReason ? (
            <label>
              <input
                type="checkbox"
                checked={archiveAccepted}
                disabled={locked || loading}
                onChange={(e) => setArchiveAccepted(e.target.checked)}
              />{" "}
              Source or display details have changed. I checked the current record and want this
              original copy.
            </label>
          ) : null}
          {saved?.html || page?.preview?.html ? (
            <iframe
              key={loadToken}
              onLoad={() => {
                if (loadToken === generation.current) setFrameReady(true);
              }}
              ref={frame}
              title={`${kind} document preview`}
              sandbox="allow-same-origin allow-modals"
              srcDoc={saved?.html ?? page!.preview!.html}
              style={{
                display: "block",
                width: "100%",
                maxWidth: "100%",
                height: 560,
                border: "1px solid #bacbc8",
                marginBlock: 12
              }}
            />
          ) : null}
          {saved ? (
            <div>
              <button type="button" disabled={!usable} onClick={print}>
                Print / Save as PDF
              </button>{" "}
              <button type="button" disabled={!usable} onClick={download}>
                Download printable HTML
              </button>{" "}
              <button
                type="button"
                disabled={locked || loading}
                onClick={() => setSelectedId(null)}
              >
                Review current source
              </button>
            </div>
          ) : page?.preview ? (
            <div>
              <label>
                <input
                  type="checkbox"
                  disabled={locked || loading}
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I reviewed this source and want an immutable generated copy.
              </label>
              <button
                type="button"
                disabled={locked || loading || !approved || loadedRevision !== sourceRevision}
                onClick={() => void generate()}
              >
                Generate reviewed copy
              </button>
            </div>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          <h4>Saved generated copies</h4>
          {copies.length ? (
            <ul>
              {copies.map((copy) => (
                <li key={copy.id}>
                  <button
                    type="button"
                    disabled={locked || loading}
                    onClick={() => {
                      setSelectedId(copy.id);
                      if (selectedId === copy.id) void read(copy.id);
                    }}
                  >
                    Open copy {copy.revision} · {copy.generatedAt}
                  </button>
                </li>
              ))}
            </ul>
          ) : !loading && !problem ? (
            <p>No generated copies yet.</p>
          ) : null}
          {page?.nextCursor ? (
            <button
              type="button"
              disabled={locked || loading}
              onClick={() => void read(selectedId, page.nextCursor!)}
            >
              Load older copies
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
