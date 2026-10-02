import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exact upstream PR #1152 post-image, not a locally invented crypto algorithm.
// Remove this backport and its advisory disposition when a fixed release ships.
export const forgePatch = Object.freeze({
  version: "1.4.0",
  advisory: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
  expires: "2026-11-01T00:00:00Z",
  integrity:
    "sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==",
  before: "fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50",
  after: "acc22e5d36e27832c34e02dd3933aad7977d45b047eead5016520735efedc9c5"
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
const unusedBrowserBundles = {
  "forge.min.js": "d9b9074e6861200d676e25dcfe97889db5e8f4150bb766d29c491ad709a51b58",
  "forge.min.js.map": "5f11be794b0ad083ce9b2bcee1079e7ee1f0771d37beb90d6f13b2b9a8a0eba3",
  "forge.all.min.js": "cb9ba4045a81825f8edb646c38d53a1ac30ce07665bf26042c8dea86d7208642",
  "forge.all.min.js.map": "0b21eb8fb1c124e963d564b6462177331027f6e739f48e73184e0f6a81cac3f1"
};

export function patchForgeSource(source) {
  if (digest(source) === forgePatch.after) return source;
  assert.equal(
    digest(source),
    forgePatch.before,
    "Unknown Forge RSA source; review before patching"
  );
  const patched = source
    .replace(
      "// validate DigestInfo structure and element count",
      "// validate DigestInfo structure and element counts (outer DigestInfo\n" +
        "          // and nested DigestAlgorithm). asn1.validate ignores extra children,\n" +
        "          // so length must be checked explicitly at each nesting level to\n" +
        "          // prevent low-exponent PKCS#1 v1.5 signature forgery (CVE-2026-85393)."
    )
    .replace(
      "obj.value.length !== 2) {",
      "obj.value.length !== 2 ||\n" +
        "            obj.value[0].value.length !==\n" +
        "              (('parameters' in capture) ? 2 : 1)) {"
    );
  assert.equal(
    digest(patched),
    forgePatch.after,
    "Forge patch differs from reviewed upstream bytes"
  );
  return patched;
}

export async function verifyDependencyPatches({
  root = process.cwd(),
  apply = false,
  now = new Date()
} = {}) {
  assert.ok(
    now < new Date(forgePatch.expires),
    "Forge backport review expired; review upstream release"
  );
  const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
  const entries = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith("node_modules/node-forge")
  );
  assert.equal(entries.length, 1, "Forge dependency topology changed; review all copies");
  const [path, entry] = entries[0];
  assert.equal(path, "node_modules/node-forge", "Unexpected nested Forge copy");
  assert.equal(
    entry.version,
    forgePatch.version,
    "Forge version changed; retire or review backport"
  );
  assert.equal(entry.integrity, forgePatch.integrity, "Forge upstream artifact changed");
  const file = resolve(root, path, "lib/rsa.js");
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    // Workspace production-only installs do not include Expo tooling.
    if (apply && error.code === "ENOENT")
      return "Forge is absent from this selected workspace install";
    throw error;
  }
  const manifest = JSON.parse(await readFile(resolve(root, path, "package.json"), "utf8"));
  assert.equal(manifest.version, forgePatch.version);
  if (apply) {
    const patched = patchForgeSource(source);
    if (patched !== source) await writeFile(file, patched);
    source = await readFile(file, "utf8");
  }
  assert.equal(
    digest(source),
    forgePatch.after,
    "Forge backport missing or modified; run npm run security:patch"
  );
  // Expo's Node consumers use lib/index.js. Do not retain unpatched standalone
  // browser bundles as an alternative entry point; unknown distribution bytes fail.
  for (const [name, hash] of Object.entries(unusedBrowserBundles)) {
    const bundle = resolve(root, path, "dist", name);
    let bytes;
    try {
      bytes = await readFile(bundle);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    assert.ok(apply, "Unpatched Forge browser distribution still installed");
    assert.equal(digest(bytes), hash, "Unknown Forge browser distribution");
    await unlink(bundle);
  }
  return "Forge 1.4.0: exact upstream PR #1152 backport verified (not an upstream release)";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(await verifyDependencyPatches({ apply: process.argv.includes("--apply") }));
  if (process.argv.includes("--trivy-policy")) {
    // Do not write a scanner disposition if the installed bytes are unverified.
    await verifyDependencyPatches();
    await mkdir(".cache", { recursive: true });
    await writeFile(
      ".cache/verified-dependency-backports.yaml",
      JSON.stringify(
        {
          vulnerabilities: [
            {
              id: "CVE-2026-85393",
              paths: ["package-lock.json"],
              purls: ["pkg:npm/node-forge@1.4.0"],
              expired_at: "2026-11-01",
              statement:
                "Fixed in installed code by byte-verified upstream PR #1152 backport; see docs/security/DEPENDENCY_BACKPORTS.md. Upstream version remains honestly 1.4.0."
            }
          ]
        },
        null,
        2
      )
    );
  }
}
