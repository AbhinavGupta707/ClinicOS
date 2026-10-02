import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateEncrypt, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import {
  forgePatch,
  patchForgeSource,
  verifyDependencyPatches
} from "../../scripts/dependency-patches.mjs";
import { assessAudit } from "../../scripts/security-audit.mjs";

const require = createRequire(import.meta.url);
const forge = require("node-forge");
const expo = require("@expo/code-signing-certificates");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = keys.privateKey.export({ type: "pkcs1", format: "pem" });
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" });
const publicKey = forge.pki.publicKeyFromPem(publicPem);
const message = Buffer.from("Synthetic ClinicOS signing regression; no clinic data");
const digest = forge.md.sha256.create().update(message.toString()).digest().getBytes();
const asn = forge.asn1;
const universal = asn.Class.UNIVERSAL;
const sequence = (children) => asn.create(universal, asn.Type.SEQUENCE, true, children);
const oid = () =>
  asn.create(universal, asn.Type.OID, false, asn.oidToDer(forge.pki.oids.sha256).getBytes());
const nil = () => asn.create(universal, asn.Type.NULL, false, "");
const octets = (value) => asn.create(universal, asn.Type.OCTETSTRING, false, value);
function signatureFor(algorithm, extra = []) {
  const der = asn.toDer(sequence([sequence(algorithm), octets(digest), ...extra])).getBytes();
  return privateEncrypt(
    { key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(der, "binary")
  ).toString("binary");
}

test("installed Forge is the reviewed upstream backport and rejects unknown source/expired review", async () => {
  assert.match(await verifyDependencyPatches(), /exact upstream/u);
  const patched = await readFile(require.resolve("node-forge/lib/rsa.js"), "utf8");
  assert.equal(patchForgeSource(patched), patched);
  assert.throws(() => patchForgeSource(patched + "\n"), /Unknown Forge/u);
  await assert.rejects(verifyDependencyPatches({ now: new Date(forgePatch.expires) }), /expired/u);
});

test("Forge rejects extra nested DigestAlgorithm elements with and without NULL", () => {
  for (const algorithm of [
    [oid(), nil(), octets("garbage")],
    [oid(), octets("garbage")],
    [oid(), nil(), nil()]
  ]) {
    assert.throws(
      () => publicKey.verify(digest, signatureFor(algorithm)),
      /valid RSASSA-PKCS1-v1_5/u
    );
  }
  assert.throws(
    () => publicKey.verify(digest, signatureFor([oid(), nil()], [octets("garbage")])),
    /valid RSASSA-PKCS1-v1_5/u
  );
});

test("Forge still verifies valid Node RSA signatures and rejects wrong messages", () => {
  for (const algorithm of ["sha1", "sha256", "sha384", "sha512"]) {
    const signature = sign(algorithm, message, keys.privateKey).toString("binary");
    const hash = forge.md[algorithm].create().update(message.toString()).digest().getBytes();
    assert.equal(publicKey.verify(hash, signature), true);
    assert.equal(
      publicKey.verify(hash.replace(/^./u, hash[0] === "x" ? "y" : "x"), signature),
      false
    );
  }
});

test("Expo resolves the patched dependency and retains certificate/signing round trip", () => {
  const expoRequire = createRequire(require.resolve("@expo/code-signing-certificates"));
  assert.equal(
    expoRequire.resolve("node-forge/lib/rsa.js"),
    require.resolve("node-forge/lib/rsa.js")
  );
  const keyPair = expo.convertKeyPairPEMToKeyPair({
    privateKeyPEM: privatePem,
    publicKeyPEM: publicPem
  });
  const certificate = expo.generateSelfSignedCodeSigningCertificate({
    keyPair,
    validityNotBefore: new Date("2026-01-01"),
    validityNotAfter: new Date("2027-01-01"),
    commonName: "Synthetic signing test"
  });
  expo.validateSelfSignedCertificate(certificate, keyPair);
  assert.equal(
    typeof expo.signBufferRSASHA256AndVerify(keyPair.privateKey, certificate, message),
    "string"
  );
});

const advisory = (url = forgePatch.advisory, name = "node-forge", severity = "high") => ({
  name,
  url,
  severity
});
const report = (via = [advisory()]) => ({
  auditReportVersion: 2,
  metadata: { vulnerabilities: { high: 2, critical: 0 } },
  vulnerabilities: {
    "node-forge": { severity: "high", nodes: ["node_modules/node-forge"], via },
    expo: { severity: "high", nodes: ["node_modules/expo"], via: ["node-forge"] }
  }
});

test("audit requires verified bytes and preserves the raw advisory counts", () => {
  assert.equal(assessAudit(report()).blockers.length, 1);
  const result = assessAudit(report(), { backportVerified: true });
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.backported, [forgePatch.advisory]);
  assert.equal(result.rawCounts.high, 2);
});

test("audit never exempts new Forge findings, different packages, nested copies or critical findings", () => {
  for (const via of [
    advisory("https://example.invalid/new"),
    advisory(forgePatch.advisory, "different"),
    advisory(forgePatch.advisory, "node-forge", "critical")
  ]) {
    assert.equal(assessAudit(report([via]), { backportVerified: true }).blockers.length, 1);
  }
  const nested = report();
  nested.vulnerabilities["node-forge"].nodes.push("node_modules/other/node_modules/node-forge");
  assert.equal(assessAudit(nested, { backportVerified: true }).blockers.length, 1);
});

test("audit fails closed on unsupported, incomplete, cyclic or unknown severity evidence", () => {
  assert.throws(() => assessAudit({}), /Unsupported/u);
  assert.throws(() => assessAudit({ ...report(), error: { summary: "network" } }), /Incomplete/u);
  assert.throws(() => assessAudit(report(["missing"])), /Missing/u);
  assert.throws(() => assessAudit(report(["expo"])), /Cyclic/u);
  assert.throws(() => assessAudit({ ...report(), vulnerabilities: {} }), /Inconsistent/u);
  assert.throws(
    () => assessAudit(report([advisory(undefined, undefined, "unknown")])),
    /severity/u
  );
});
