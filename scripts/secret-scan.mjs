import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const ignoredPathFragments = [
  "package-lock.json",
  "clinic_os_specs_v2/",
  "fixtures/synthetic/",
  "node_modules/",
  "dist/",
  "coverage/"
];

const patterns = [
  {
    name: "private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/
  },
  {
    name: "AWS access key id",
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
  },
  {
    name: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/
  },
  {
    name: "Slack webhook URL",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/
  },
  {
    name: "OpenAI API key",
    regex: /\bsk-[A-Za-z0-9_-]{32,}\b/
  },
  {
    name: "Razorpay live key id",
    regex: /\brzp_live_[A-Za-z0-9]{10,}\b/
  }
];

const findings = [];

for (const file of trackedFiles) {
  if (ignoredPathFragments.some((fragment) => file.includes(fragment))) continue;

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    if (pattern.regex.test(contents)) findings.push(`${file}: possible ${pattern.name}`);
  }
}

if (findings.length > 0) {
  console.error("Potential committed secrets found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Tracked-file secret scan passed.");
