# ClinicOS Media Scanner

Dedicated container-image Lambda that reads exact-version GuardDuty S3 scan state and asks its
isolated asymmetric KMS key to sign the bounded ClinicOS evidence envelope. The API may invoke this
function and verify evidence; it never receives `kms:Sign` permission.

The handler is intentionally fail-closed at module initialization. Its environment is supplied by
the Terraform malware-scanner module, and it emits no PHI or provider diagnostics.

The production image intentionally removes npm, Corepack, and the local-only Lambda Runtime
Interface Emulator. Use `infra/images/media-scanner/test-runtime.sh IMAGE` for the repeatable
network-isolated packaging and fail-closed smoke test.
