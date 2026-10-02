# Reviewed dependency backport — 2026-10-02

`node-forge` 1.4.0 remains the newest upstream release. Its nested RSA
DigestAlgorithm validation is affected by GHSA-86w9-cpqp-85rv / CVE-2026-85393.
ClinicOS uses it transitively through Expo CLI and Expo code-signing tooling;
this is not grounds for ignoring the defect.

The install hook applies the exact `lib/rsa.js` post-image from
[upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152), revision
`ceba34402e329f0365134f23fe19898756527d65`. The proposal is not an upstream release
or a merged maintainer fix. The change rejects surplus children in the nested
algorithm sequence after ordinary ASN.1 validation. It does not change signature
generation, RSA arithmetic, padding, accepted digest algorithms or key generation.

`scripts/dependency-patches.mjs` requires the exact registry integrity, version,
single locked dependency location, and before/after SHA-256. Unknown bytes or
dependency topology fail closed. Normal installs apply it automatically;
`--ignore-scripts` installs must explicitly run `npm run security:patch` before
using Expo. `npm run security:patch:verify` never repairs silently. Production
workspace installs without Expo skip the absent package. Root full verification
requires it to be present. No package is renamed or given a fictitious release.
The unused prebuilt browser bundles and their maps are removed only after exact
hash checks; they contain the old verifier and must not remain as an alternate
entry point. Expo's Node consumers resolve `lib/index.js`. ClinicOS does not
support direct imports of the removed standalone browser distributions.

The regression suite exercises malformed nested/outer structures, legitimate
RSA signatures and the actual Expo certificate/signing consumer. The unpatched
upstream copy was also checked to accept the malformed nested structure, making
the regression meaningful. Original BSD/GPL licensing and upstream attribution
remain in the installed package; no redistributed source fork is introduced.

Version-only scanners still report the upstream advisory. The npm gate prints
raw counts and separately identifies this **fixed-by-backport** advisory, only
after installed-byte verification. All other high/critical advisories still fail,
including new Forge findings and transitive findings. Trivy's repository policy
is generated only after the same verification and regression suite. It names
only this CVE, package/version and lockfile. It is not used for image or Terraform
scans. This is a disposition for repaired code, not acceptance of unpatched code.

The patch and disposition expire on **2026-11-01** and then block the gate.
Replace them with an official patched release as soon as one is available; rerun
the signature/Expo regression suite, remove the install hook and dispositions,
and return to the unmodified audit command. Keep current raw audit output with
acceptance evidence so a green gate is never described as zero raw advisories.
