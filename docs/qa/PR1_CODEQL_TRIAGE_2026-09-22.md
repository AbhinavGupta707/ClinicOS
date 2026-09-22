# PR #1 CodeQL alert review — 22 September 2026

A successful CodeQL workflow means the analysis ran; it does not mean the
branch has no open alerts. We separately inspected all 23 open alerts recorded
on `a3e0b4e5572e35e1280e91b5ea79484bc29e4d53`, reviewed their callers and bounds,
and obtained independent read-only review. All 23 sites predate PR #1's base
`mac-latest-20260829` (`2a4cd31f57d892810c5dfb692266b3965412aff2`).

No alert was dismissed in GitHub and no CodeQL rule was disabled. Dispositions
below apply to these exact execution paths and must be revisited if input
sources, schemas, callers or tooling behavior change. They are not a general
exemption for high-severity findings.

## Repairs

| Alerts | Finding and repair                                                                                                                                                                                                                                                          | Regression                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Runtime email validation still ran an ambiguous regex after recording a length violation. Replace it with a bounded character scan, retaining the current API email contract's 320-character ceiling.                                                                       | Overlength adversarial input, malformed addresses and a valid address.                                                                            |
| 5      | Patient CSV cells reached an ambiguous email regex without a per-cell bound. Reuse the practitioner import's existing bounded linear validator.                                                                                                                             | A 40K-character patient email is rejected with `invalid_email`.                                                                                   |
| 6      | Free-text error/audit redaction could backtrack on arbitrary input. Tokenize maximal email-like runs once; only candidates of at most 254 characters enter the existing permissive matcher. Redact larger address-like runs completely, without leaking a truncated suffix. | Normal masking retained; 100K-character local/domain runs, no-address input and custom replacement tested through direct and recursive redaction. |
| 9      | No concrete current credential leak was established, but the restore CLI catch printed arbitrary exception messages. Emit a fixed failure message at that boundary.                                                                                                         | A failing CLI argument cannot appear in output; argument validation exits before environment loading or any service operation.                    |

The email changes are in `077ed809`; diagnostic hardening is in `33db6a3f`.
Remote analysis at `33db6a3f` closed alerts 1, 5, 6 and 9 without API
dismissals; 19 classified alerts remain open. The same 19 open IDs were rechecked at source candidate `51595122`; no new
alerts appeared. A later changed head still requires a fresh check. Previously introduced PR alerts 22 (practitioner email) and 25
(acceptance artifact data) were also fixed in source; the latter writes only
validated, known readiness fields rather than the raw network response.

## Remaining classifications

| Alerts | Current source and execution boundary                                                                                                                                                                                                                                      | Decision                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–3    | Generated client's `interpolatePath` and native `normalizedRouteKey` consume static route templates from the contract registry, not HTTP/path parameter input. Dynamic values are encoded separately. `generation.ts` owns the generated template.                         | No attacker-controlled regex input in the current call graph. Preserve generator/output consistency in any future hardening.                                                                    |
| 4      | `sanitizeObjectKeySegment` processes the configured environment and a filename extension bounded to 12 alphanumeric characters; the API filename contract is also bounded to 255. The stricter media path uses generated storage names.                                    | No material unbounded request-input path established. Review again before exposing arbitrary environment/object-key segments; linear trimming would be future hardening.                        |
| 23     | S3 raw-webhook prefix trimming receives constructor configuration, not webhook contents. The normalized prefix is capped at 512 characters. The raw configured value is not length-capped before trimming.                                                                 | Configuration-only complexity exposure, not a remote request DoS in the current path. Future hardening may cap raw input and trim with index scans; do not claim an existing pre-trim bound.    |
| 24     | FHIR Provenance `policy` is shape-validated as `string[]` before semantic checking. Its `includes` call uses exact **array element equality**, not string substring matching.                                                                                              | False positive; replacing it with `some` would be clarity-only, not a security fix.                                                                                                             |
| 7      | The ABDM unit test asserts that serialized redacted output does **not** include a synthetic URL. It neither authorizes an origin nor sends a request.                                                                                                                      | False positive; retain the negative redaction assertion.                                                                                                                                        |
| 8      | Restore summary selects status, fixed synthetic dataset names/counts, numeric RPO/RTO, AWS region labels and fixed warnings. It does not print the environment or restore connection URL.                                                                                  | No credential sink in the selected summary fields.                                                                                                                                              |
| 10–17  | CP2/3/5/6/7/8/9 contract smokes and CP9 load smoke intentionally send versioned synthetic scenario requests to an operator-selected API. Current loaders/validators constrain paths to `/v1/` or approved health paths; scenario paths cannot replace the configured host. | Intentional CLI test behavior, not a product arbitrary-file/network endpoint. These tools are not permission to contact a live provider; using them still requires an approved target and data. |
| 18     | Secret scanner checks full file contents for an embedded webhook credential pattern.                                                                                                                                                                                       | False positive: anchoring to the whole file would weaken secret detection.                                                                                                                      |
| 19–21  | CP4 fixture validation rejects provider/storage hostname patterns anywhere in serialized fixture text.                                                                                                                                                                     | False positives: these are leakage detectors, not hostname allowlists.                                                                                                                          |

Relevant source: `packages/api-client-generated/src/index.ts`,
`packages/api-contracts/src/{generation,native-http-contracts,runtime-schema}.ts`,
`packages/domain/src/{migration,media}.ts`, `packages/security/src/redaction.ts`,
`packages/integrations/src/cp15/meta-whatsapp/s3-raw-body-store.ts`,
`packages/fhir/src/document-validation.ts` (Provenance shape and semantic checks),
`packages/fhir/test/abdm.test.ts`, `scripts/cp9-restore-drill.mjs`, the named
contract/load smoke scripts and their fixture validators, `scripts/secret-scan.mjs`.

The source review establishes no unresolved material security finding in the
current MVP import workflow after the repairs above. It does **not** claim zero
open CodeQL alerts, production approval, or that the broader deferred provider,
mobile and operational surfaces have received live acceptance.
