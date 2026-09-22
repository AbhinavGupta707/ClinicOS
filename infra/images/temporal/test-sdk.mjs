import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

const address = process.argv[2];
assert.match(address ?? "", /^clinicos-temporal-server-[a-zA-Z0-9-]+:7233$/u);
const deadline = setTimeout(() => { console.error("Synthetic Temporal smoke timed out"); process.exit(1); }, 180_000);
let connection;
let native;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { connection = await Connection.connect({ address, connectTimeout: "2 seconds" }); break; }
    catch { await delay(1000); }
  }
  assert.ok(connection, "Temporal server did not become ready");
  const namespace = `smoke-${randomUUID()}`;
  await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: { seconds: 86400 } });
  // Namespace propagation is eventually consistent across server services.
  await delay(5000);
  const client = new Client({ connection, namespace });
  native = await NativeConnection.connect({ address });
  const taskQueue = `security-smoke-${randomUUID()}`;
  const workflowsPath = new URL("./test-workflows.cjs", import.meta.url).pathname;
  const worker = await Worker.create({ connection: native, namespace, taskQueue, workflowsPath,
    activities: { confirmSyntheticValue: async (value) => ({ value, confirmed: true }) },
    shutdownGraceTime: "5 seconds" });
  const workflowId = randomUUID();
  const value = randomUUID();
  await worker.runUntil(async () => {
    const result = await client.workflow.execute("securityImageSmoke", {
      taskQueue, workflowId, args: [value], workflowExecutionTimeout: "45 seconds"
    });
    assert.deepEqual(result, { value, confirmed: true });
  });
  const history = await client.workflow.getHandle(workflowId).fetchHistory();
  assert.ok(history.events.length > 5);
  await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
  console.log("Temporal SDK 1.22 image smoke passed: native connection, poll, activity, timer, result, shutdown and replay");
} finally {
  await native?.close();
  await connection?.close();
  clearTimeout(deadline);
}
