import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { forgePatch, verifyDependencyPatches } from "./dependency-patches.mjs";

export function assessAudit(report, { backportVerified = false } = {}) {
  assert.equal(report.auditReportVersion, 2, "Unsupported npm audit response");
  assert.ok(
    report.vulnerabilities && report.metadata?.vulnerabilities && !report.error,
    "Incomplete npm audit response"
  );
  const levels = ["info", "low", "moderate", "high", "critical"];
  for (const level of levels) {
    assert.equal(
      Object.values(report.vulnerabilities).filter((item) => item.severity === level).length,
      report.metadata.vulnerabilities[level] ?? 0,
      "Inconsistent npm audit severity counts"
    );
  }
  for (const item of Object.values(report.vulnerabilities)) {
    assert.ok(
      levels.includes(item.severity) && Array.isArray(item.nodes) && item.nodes.length > 0,
      "Incomplete npm vulnerability evidence"
    );
  }
  const blockers = new Set();
  const backported = new Set();
  const visit = (name, path = new Set()) => {
    assert.ok(!path.has(name), "Cyclic npm audit dependency evidence");
    const item = report.vulnerabilities[name];
    assert.ok(
      item && Array.isArray(item.via) && item.via.length > 0,
      "Missing npm audit dependency evidence"
    );
    for (const via of item.via) {
      if (typeof via === "string") {
        visit(via, new Set([...path, name]));
      } else {
        assert.ok(
          via && ["info", "low", "moderate", "high", "critical"].includes(via.severity),
          "Unknown npm severity"
        );
        if (!["high", "critical"].includes(via.severity)) continue;
        if (
          backportVerified &&
          name === "node-forge" &&
          via.name === "node-forge" &&
          via.url === forgePatch.advisory &&
          via.severity === "high" &&
          item.nodes.length === 1 &&
          item.nodes[0] === "node_modules/node-forge"
        ) {
          backported.add(via.url);
        } else {
          blockers.add(`${name}: ${via.url ?? via.title ?? "unknown advisory"}`);
        }
      }
    }
  };
  for (const name of Object.keys(report.vulnerabilities)) visit(name);
  return {
    blockers: [...blockers],
    backported: [...backported],
    rawCounts: report.metadata.vulnerabilities
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(await verifyDependencyPatches());
  const result = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || ![0, 1].includes(result.status))
    throw new Error("npm audit could not complete");
  const assessment = assessAudit(JSON.parse(result.stdout), { backportVerified: true });
  console.log(JSON.stringify(assessment, null, 2));
  if (assessment.blockers.length) process.exitCode = 1;
}
