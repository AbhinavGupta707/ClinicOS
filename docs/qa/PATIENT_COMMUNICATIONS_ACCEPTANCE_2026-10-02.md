# Patient communications — engineering acceptance

Date: 2026-10-02. Branch: `codex/patient-communications`. Base:
`de3b1dc79fac060e4ed9c6a44df5d1631bddee95` (`mac-latest-20260829`, merged PR #11).
Scope is the first appointment communication loop in
[the implementation plan](../orchestration/PATIENT_COMMUNICATIONS_NEXT_SLICE_2026-10-02.md).
Local engineering acceptance passed. Merge requires successful checks on the
reviewed PR head; consult that PR's current checks for the final CI decision.
Live provider activation and production release remain NO-GO.

## What staff can do

1. Open **Patient messages**. Verified incoming text appears in a clinic/account
   conversation. Unsupported incoming media is labelled without downloading it.
2. Review the contact, explicitly select the correct patient and optionally link
   an existing enquiry. A shared family number never selects a patient silently.
3. Assign eligible staff, mark work open/waiting/handled, mark displayed messages
   read, or save an attributed manual-contact record. Manual evidence does not
   claim provider delivery. Conversation evidence remains attached to the contact,
   not retroactively copied to a patient's clinical chart.
4. For an eligible patient with consent, choose a current upcoming appointment and
   a supported template. Fetch its verified definition and review the exact text
   and recipient. Approval queues that reviewed snapshot for up to 15 minutes.
5. Inspect queued, accepted, failed or uncertain dispatch and separately reported
   sent/delivered/read status. Cancel a queued request before dispatch. Follow the
   existing enquiry/appointment links for actual booking or confirmation; receipt
   status does not change attendance, booking or clinical records.

With official sending disabled, the inbox and manual records remain usable while
preview, template fetch and approval return an explicit unavailable response.

## Safety and persistence

- Six registered native operations use the same current authority, idempotency,
  generated contracts, BFF route family and atomic audit path as the rest of the
  daily product. Accounting users cannot read conversations.
- Migration 0036 adds five forced-RLS tables, composite scope foreign keys,
  immutable message/approval evidence, stable message paging and monotonic per-user
  read positions. Historical signed receipts are backfilled without retransmission.
- Incoming projection runs only after the existing verified callback boundary.
  Replayed/invalid callbacks cannot add duplicate/unverified inbox messages.
- Recipient, patient, appointment revision, clinic time zone, consent evidence,
  registration and template definition are bound into the approval digest. The
  browser cannot supply arbitrary text or a replacement recipient.
- Before dispatch, the worker establishes RLS, verifies current staff authority,
  rereads consent/source/registration and compares the official template definition.
  Contact locks serialize STOP processing with message dispatch. Any recorded STOP
  on that account/contact blocks appointment messages, including shared numbers.
- A durable lease is committed before transport. A lost lease, thrown transport
  result or unknown outcome becomes uncertain and enters reconciliation; no blind
  resend. The finalizer fences stale workers. Only proven no-dispatch outcomes
  retry, with at most three transport attempts and approval expiry still enforced.
- Raw credentials/provider error bodies are not returned. Template lookup uses a
  fixed Graph host, validated version/numeric ID, no redirects, a 10-second timeout
  and a 256 KiB response limit.

## Evidence and reproducibility

All local data, caches, logs, screenshots and native database files remain under
`.audit-spectra-retirement-20260920/` on Spectra. Existing dependencies were used.
Desktop, existing Docker services and actual clinic data were untouched.

The approved native harness uses loopback-only owned PostgreSQL/Redis processes,
fresh migrations, runtime grants and synthetic identity. It records ownership and
cleanup. These commands must only be run with the existing explicit synthetic
service authorization:

```sh
python3 scripts/test-migration-assurance-native.py --run-approved-synthetic-services
python3 scripts/test-migration-assurance-native.py --run-approved-synthetic-services --communications-only
python3 scripts/test-migration-assurance-native.py --run-approved-synthetic-services --communications-upgrade-only
```

Completed local integration evidence:

- Workspace check, typecheck, lint, **1,231 tests (zero skipped)**, builds, exact
  dependency-patch verification and release-scope secret scan all passed.
  OpenAPI/client drift and inventory checks cover **187 registered routes**.
  Gate logs and `final-gates.json` are in `patient-communications-20261002`.

- Full native regression: all 30 orchestration steps passed in
  `migration-assurance-20261002/native-8s8scwqk`: migrations/grants/RLS, 233 API
  tests (zero skipped), messaging, financial operations, source context/history,
  media, import/front-desk/daily workflows, documents, migration assurance and
  restore. The three browser runs passed **28 cases, zero skipped/retried**.
- The 5,000-patient probe independently reconciled 10,000 staged rows over two
  snapshots and zero duplicate patients on replay. The actual backup restored
  **144 tables and 10 documents**, passed schema/content comparison and runtime
  RLS/migration verification. All three owned native processes exited cleanly.
- The final targeted communications rerun after template-ID normalization passed
  in `patient-communications-20261002/native-stwqgqy5`, including its 233 API tests,
  database scenarios and four browser cases. Its owned PostgreSQL/Redis exited
  cleanly. JSON numeric IDs are accepted only when lossless; unsafe integers fail
  validation. The last single-placeholder bound and JSX escaping repair passed
  workspace tests/builds; the CI communications probe is also required on the
  reviewed PR head.

- Fourteen real-database scenarios cover signed callbacks, replay, invalid
  signatures, media limitations, paging, read watermarks, clinic isolation,
  assignment/version races, current review digest, send replay prevention,
  source/template drift, bounded no-dispatch retry, uncertain outcome, approval
  expiry, constructor failure, expired lease and delayed response fencing,
  monotonic signed status callbacks and shared-contact STOP.
- The outgoing feature handler and response contract are exercised against real
  PostgreSQL; provider lookups/sends use typed synthetic ports, not network calls.
- Four real HTTP/API/PostgreSQL browser cases cover desktop/manual persistence,
  mobile paging and overflow, role/stale/idempotency rejection, and enabled exact
  review/queue/cancel/reload. No browser request interception is used. The enabled
  approval case has no worker running and cancels its queued request. Provider
  dispatch fault tests run separately through the production worker handler with
  injected typed transports.
- An upgrade rehearsal seeded two verified receipts at schema 035, applied 036,
  observed exactly two messages, replayed projection without duplication and
  verified forced RLS on all five new tables plus both source tables. An unscoped
  runtime query saw zero conversations. Evidence:
  `patient-communications-20261002/native-8yd6_jxh` under the scratch parent.
- Dependency policy passes: **0 critical, 4 raw high, 13 moderate**. The high
  findings trace to the existing exact verified node-forge upstream backport;
  the audit found no unhandled high/critical blocker. This is not a claim of zero
  raw advisories or an upstream patched release. No dependency versions changed.

The in-app browser backend was unavailable in this session. The existing
Playwright/Chromium harness exercised the actual built Next.js UI and saved
desktop/mobile screenshots; synthetic auth does not establish real OIDC sign-in.

Earlier failed rehearsal logs are retained. Failures led to fixes for PostgreSQL's
unsupported template-name regex repetition, an outbox UUID/text parameter cast,
lease/retry constraints, and test fixture/accessible-label issues. The old
template-name constraints were repaired in migration 0036, preserving prior
migration checksums. The bulk-import duplicate-name safeguard was not relaxed;
the new communication fixtures were renamed to avoid unrelated synthetic names.

## Activation requirements and remaining scope

**Live WhatsApp / clinic use: NO-GO until controlled activation and acceptance.**
Synthetic tests do not demonstrate Meta delivery, patient consent adequacy, real
clinic sign-in, deployed callbacks, staff acceptance or production operations.

The clinic must authorize its account/number arrangement, complete the official
registration flow and activate signed HTTPS callbacks and protected credentials.
Verify the existing-number/coexistence rules with Meta for that actual account;
do not assume that a number can be transferred without consequences.

The supported appointment template is an approved UTILITY template with one plain
BODY with one occurrence of the positional `{{1}}` appointment-details parameter. Header/footer/buttons,
media and other parameter forms remain unsupported. The current discovery input
is a signed template lifecycle callback; there is no bulk catalog import or
template-creation UI. Once discovered, staff can fetch the selected template's
definition through the official
[template read API](https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates).
Definition freshness is bounded to 24 hours and checked again before sending.

Use a clinic-approved test recipient and recorded consent to prove one exact
message, signed delivered/read receipts, reply, STOP and failure recovery before
patient use. Reconciliation of an unknown send needs actual provider evidence;
an operator cannot turn uncertainty into permission to resend.

Deferred: unrestricted replies, template catalog onboarding, media retrieval,
reviewed opt-in after STOP, recall messaging, campaigns, AI, email and automated
attendance. The existing care-instruction sender is a separate older path; its
direct-SQL RLS initialization, thrown-transport classification and reconciliation
index predicate need a dedicated real-database safety pass before enabling it.
This slice does not certify that older path by association.

The private export profile, staff rehearsal and real migration acceptance remain
separate pending work. Neither patient CSVs nor AI API keys were needed for this
implementation.
