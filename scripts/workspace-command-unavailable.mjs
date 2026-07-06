const [workspaceName, expectedRuntime, activationFlow] = process.argv.slice(2);

if (!workspaceName || !expectedRuntime || !activationFlow) {
  console.error(
    "Usage: workspace-command-unavailable.mjs <workspace> <expected-runtime> <activation-flow>"
  );
  process.exit(2);
}

console.error(`${workspaceName} runtime is not registered yet.`);
console.error(`Expected runtime: ${expectedRuntime}.`);
console.error(`Activation flow: ${activationFlow}`);
console.error(
  "This is an intentional unavailable state for the app shell. Quality gates skip absent app scripts until the owning lane installs the real runtime."
);
process.exit(1);
