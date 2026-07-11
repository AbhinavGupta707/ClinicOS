import assert from "node:assert/strict";
import test from "node:test";
import { validateSbomLicenses } from "../../scripts/check-sbom-licenses.mjs";

function sbom(components) {
  return { bomFormat: "CycloneDX", components };
}

test("SBOM license gate accepts internal packages, permissive licenses, and reviewed metadata gaps", () => {
  const result = validateSbomLicenses(
    sbom([
      { name: "api", version: "0.0.0", purl: "pkg:npm/%40clinic-os/api@0.0.0" },
      { name: "dependency", version: "1.0.0", licenses: [{ license: { id: "MIT" } }] },
      {
        name: "node-forge",
        version: "1.4.0",
        licenses: [{ expression: "BSD-3-Clause OR GPL-2.0" }]
      },
      { name: "busboy", version: "1.6.0" }
    ])
  );

  assert.match(result, /4 production components/u);
});

test("SBOM license gate rejects unreviewed missing metadata", () => {
  assert.throws(
    () => validateSbomLicenses(sbom([{ name: "unknown", version: "1.0.0" }])),
    /unknown@1\.0\.0: missing license metadata/u
  );
});

test("SBOM license gate rejects non-commercial and reciprocal-only dependencies", () => {
  assert.throws(
    () =>
      validateSbomLicenses(
        sbom([
          { name: "network", version: "1.0.0", licenses: [{ license: { id: "AGPL-3.0" } }] },
          { name: "runtime", version: "2.0.0", licenses: [{ license: { id: "GPL-3.0" } }] }
        ])
      ),
    /forbidden license AGPL-3\.0[\s\S]*reciprocal GPL license requires legal approval/u
  );
});
