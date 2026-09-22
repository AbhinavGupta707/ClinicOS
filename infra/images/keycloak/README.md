# ClinicOS Keycloak security rebuild

The image is a ClinicOS-maintained rebuild of Keycloak 26.7.4, **not an official
Keycloak binary distribution**. The upstream image still bundled vulnerable
Netty and Bouncy Castle libraries when this repair was prepared on 2026-09-22.

The Dockerfile pins the upstream source commit/archive checksum, Maven builder
and Java runtime. `security-boms.patch` imports the complete Netty 4.1.137.Final
and Bouncy Castle 1.85 BOMs before other imported BOMs in the source POM. Maven's
effective dependency management, both downloaded BOM checksums and the rebuilt
library inventory are checked by `verify-source-build.py`. No compiled JAR is
overlaid onto an existing distribution, and no vulnerability is suppressed.

The selected upstream server reactor runs its unit tests during compilation.
This is not the entire upstream integration testsuite. The later `kc.sh build`
optimizes the distribution for PostgreSQL, health and metrics. CI then verifies
the assembled ARM64 image, realm import, client credentials and worker claims,
interactive authorization-code login with required S256 PKCE, JWKS signatures,
single-use authorization codes, refresh-token rotation/replay rejection and
logout. These use ephemeral synthetic users and an internal Docker network.
The image creates the data/import and transaction-log directories with ownership
for its non-root runtime user before any import mount is applied. CI checks
writability and rejects recovery-module initialization warnings, then restarts
the owned Keycloak container against the same disposable database and repeats
interactive OIDC. This proves restart/re-authentication, not an in-flight XA
crash-recovery or production restore drill.
The HTTP protocol smoke does not establish production HTTPS, MFA, or ClinicOS
application session integration.

Build provenance is included under `/opt/clinicos/provenance/`: source revision,
archive and patch hashes, managed versions, distribution hash, library hashes
and upstream unit-test counts. CI retains this provenance, the assembled image
ID and an image SBOM. The distribution hash describes the source-build output;
the image ID and final scan identify the later optimized deliverable.

Maintenance: prefer a future official Keycloak distribution once its actual
dependency inventory includes both fixes and the same image/runtime gates pass.
Then remove the source patch and build-specific verification coherently. Any
source, BOM, builder or runtime update requires new checksum verification,
dependency alignment, unit tests, final-image runtime checks and a fresh scan.
Do not silently change the published version or call this fork upstream-supported.

References: [Keycloak source build instructions](https://github.com/keycloak/keycloak/blob/26.7.4/docs/building.md),
[Netty security advisory](https://github.com/netty/netty/security/advisories/GHSA-c4c3-7fpv-j4q5),
[Bouncy Castle advisory](https://github.com/bcgit/bc-java/wiki/CVE%E2%80%902026%E2%80%908763),
[Maven dependency-management precedence](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html).

The realm import explicitly enables upstream `CreateDefaultClientScopes` before
adding its custom scopes. Keycloak otherwise skips standard scope creation when
`clientScopes` is present, so merely naming `basic` in a client is insufficient.
Both interactive clients include `basic` for signed `sub`/`auth_time` claims; the
runtime smoke verifies the actual tokens. Existing deployed realms are not
modified by this source change or by an import that skips an existing realm;
any later deployment must review and apply the corresponding realm update.
