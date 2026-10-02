# Patient document generation architecture — 2026-10-02

Native printable HTML v1, generated on the server from an immutable structured
snapshot. Preview, exact HTML download, browser Print / Save as PDF. Do not label
an HTML download PDF or claim identical PDF bytes across browsers. No new runtime
dependency, server Chromium, provider calls or object-store activation. PostgreSQL
stores issuance metadata and bounded structured source snapshots; generated HTML
is derived, never a stored blob. Future archived PDF bytes use the existing private
S3-compatible media boundary. This preserves canonical architecture02's separation.

Record renderer version and SHA256 of exact UTF-8 HTML. Old v1 renderer must remain
available; hash mismatch is an unavailable error, never silently rewritten output.
Escape every source text value; no links, raw markup, script, remote assets or
user-provided URLs. CSP default-src none and scriptless sandboxed preview. Bounded
paragraphs/tables, wrapping, repeated table headers, A4 pagination and page numbers.
Chrome is the verified print target; do not claim all printers/browsers validated.
Synthetic prototype: 90 rows plus long Hindi/English text printed to 8 pages,
final marker retained; pages1/2 inspected with Poppler, mobile overflow absent.

Composition source: saved signed prescription (signer name/id/date, exact meds,
no invented licence/signature); saved treatment estimate with explicit plan status,
phase/item labels/prices frozen; issued invoice including exact line totals and
as-of financial balance; generated receipt with frozen allocations, no inference
of bank settlement; saved approved print instruction, no generic fallback; lab slip
with vendor, due date, clinical/item details, omitting internal notes/agreed cost.

One new documents persistence helper, typed domain snapshot/renderer and shared UI
panel. Four repository methods (prepare/issue/list/read), three public route
operations (prepare+bounded history, issue with expected source digest, exact read).
Patient/kind/source IDs are all checked. A narrow patient.document.read central
permission gates the route family; the handler additionally enforces source-specific
authority before any read: prescription requires patient+PHI+clinical-note read;
clinical treatment estimates require patient+PHI+dental-chart+billing read;
invoice/receipt require billing read; instructions require patient read+instruction
write; lab slips require patient+PHI+lab manage. Reception/accounting do not receive
broad clinical-history permission. Financial and instruction output omit birthdate. Read/preview
audit metadata excludes document contents. Issuance audit/outbox/idempotency use
existing transaction coordinator; no delivery/print-success event.

Issue re-reads and locks current patient/clinic/source and dependent display data,
compares preview digest, rejects changed sources409. Source-key advisory lock
serializes distinct request keys. Latest equal snapshot reuses generated copy;
changed snapshot gets revision+1 and previous-generated-copy reference. Retry with
same idempotency key returns same result; changed request body conflicts.
Immutable update/delete triggers, scoped patient FK, FORCE RLS, bounded keyset
history. Historical copy remains readable when source later becomes void/cancelled;
UI must warn/disable routine use, and output identifies the as-issued snapshot.

Shared UI uses parent's existing workflow mutation coordinator; capture exact
patient/source/preview digest for uncertain retries. No new stale scope race,
mutable patient ID box, fake success, or print-on-issuance side effect. Preview
first, explicit record generation, then download/print. Reopen exact saved copies
after reload; show unavailable/load/error/empty states and mobile reachable controls.

Acceptance: source states and permission negatives; wrong patient/kind/source;
stale preview after patient/clinic/source edits; concurrent issuance dedup; replay;
forced audit failure rollback; immutable snapshot and source records; generated
HTML identical after later profile/price/payment changes; original receipts after
correction marked historical; no internal lab notes; exact integer INR calculations;
HTML escaping/CSP; Unicode and long multi-page output visually inspected. Six
real API/Postgres browser source types, download hash, print invocation (not physical
printing), mobile and existing daily/import regressions. All local/remote gates,
independent bounded review and exact-head merge. Real clinic sign-off remains open.

Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing
Reference: https://developer.chrome.com/blog/print-margins

Open generated copies are invalidated by fetched-source revision changes and parent
mutation locks. A fresh read and any changed-source acknowledgement are required
before print/download re-enable. Void/cancelled or unsupported current sources keep
historical inspection available, but disable routine export of that old copy.
The application cannot revoke a file already downloaded or check its status offline.

Document provenance is printed compactly after content; patient/clinical facts use
two columns. The v1 renderer has a pinned golden SHA256 test: future presentation
changes must introduce a new renderer version while keeping archived v1 available.

## Staff workflow

1. Open the saved prescription, selected treatment plan/invoice, receipt,
   saved print instruction or lab case in its existing workspace.
2. Select **Review … document**. Check patient identity, source status, content
   and amounts in the preview. Previewing creates no generated copy.
3. Tick the review acknowledgement and select **Generate reviewed copy**.
   A repeated request for the same current source returns the same copy.
4. Review that saved copy, then download its printable HTML or select
   **Print / Save as PDF**. Inspect the browser's paper size, margins and every
   page before printing. These actions do not record delivery or completion.
5. Saved-copy history reopens the exact recorded rendering. After source changes,
   explicitly acknowledge the original copy or review the new current source
   and generate a new revision. Cancelled/void sources allow inspection only.
6. If a write outcome is uncertain, use the workspace's retry/recovery control.
   It retains the original operation key; do not create a replacement blindly.

The local engineering target is Chrome/Chromium A4 print output. Clinic stationery,
legal/tax details, clinician registration details, dispensing requirements, actual
printer output and staff approval must be validated before patient-facing use.
No physical printing, live patient handover, messaging or bank settlement is
established by the synthetic acceptance evidence.
