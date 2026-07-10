import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const missingLicenseAllowlist = new Map([
  ["busboy@1.6.0", "MIT license is declared by the upstream package repository"],
  ["streamsearch@1.1.0", "MIT license is declared by the upstream package repository"],
  ["unionfs@4.6.0", "Apache-2.0 license is declared by the upstream package repository"]
]);
const forbiddenLicense =
  /\b(?:AGPL|SSPL|BUSL|Commons[- ]Clause|Elastic[- ]License|PolyForm|Non[- ]Commercial)\b/iu;

export function validateSbomLicenses(sbom) {
  if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
    throw new Error("License gate requires a CycloneDX SBOM with a components array");
  }
  const violations = [];

  for (const component of sbom.components) {
    const purl = typeof component.purl === "string" ? component.purl : "";
    const internal = purl.startsWith("pkg:npm/%40clinic-os/");
    const identity = `${component.name ?? "unknown"}@${component.version ?? "unknown"}`;
    const licenses = Array.isArray(component.licenses)
      ? component.licenses
          .map((entry) => entry.expression ?? entry.license?.id ?? entry.license?.name)
          .filter((value) => typeof value === "string")
      : [];

    if (licenses.length === 0 && !internal && !missingLicenseAllowlist.has(identity)) {
      violations.push(`${identity}: missing license metadata`);
      continue;
    }

    for (const license of licenses) {
      if (forbiddenLicense.test(license)) {
        violations.push(`${identity}: forbidden license ${license}`);
      }
      if (/\bGPL-[0-9]/iu.test(license) && !/\sOR\s/iu.test(license)) {
        violations.push(`${identity}: reciprocal GPL license requires legal approval (${license})`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`SBOM license policy failed:\n${violations.join("\n")}`);
  }

  return (
    `SBOM license policy passed for ${sbom.components.length} production components; ` +
    `${missingLicenseAllowlist.size} pinned upstream metadata exceptions reviewed.`
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [sbomPath] = process.argv.slice(2);
  if (!sbomPath) {
    throw new Error("Usage: node scripts/check-sbom-licenses.mjs <cyclonedx-json>");
  }
  const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
  console.log(validateSbomLicenses(sbom));
}
