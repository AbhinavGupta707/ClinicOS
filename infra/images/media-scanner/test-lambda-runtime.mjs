import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

// Runs only inside the candidate, with Docker --network none. A loopback Runtime
// API delivers invalid synthetic input so the real Lambda bootstrap loads the
// real handler/SDK and proves denial without making any AWS calls.
assert.equal(existsSync("/var/runtime/node_modules/@aws-sdk"), false);
const require = createRequire("/var/task/packages/integrations/package.json");
for (const name of ["@aws-sdk/client-s3", "@aws-sdk/client-kms"]) {
  assert.ok(require.resolve(name).startsWith("/var/task/"), "Handler must use packaged SDK");
}
let resolveResult, rejectResult;
const result = new Promise((resolve, reject) => {
  resolveResult = resolve;
  rejectResult = reject;
});
let delivered = false;
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/2018-06-01/runtime/invocation/next") {
      if (delivered) return; // Long poll until the test's cleanup closes the server.
      delivered = true;
      response.writeHead(200, {
        "content-type": "application/json",
        "lambda-runtime-aws-request-id": "synthetic-runtime-check",
        "lambda-runtime-deadline-ms": String(Date.now() + 10000),
        "lambda-runtime-invoked-function-arn":
          "arn:aws:lambda:ap-south-1:000000000000:function:synthetic-test"
      });
      response.end("null");
      return;
    }
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/2018-06-01/runtime/invocation/synthetic-runtime-check/error");
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length < 16384, "Unexpected runtime error body size");
    }
    assert.equal(JSON.parse(body).errorType, "GuardDutyEvidenceError");
    response.writeHead(202).end();
    resolveResult();
  } catch (error) {
    response.writeHead(500).end();
    rejectResult(error);
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const child = spawn("/var/runtime/bootstrap", [], {
  env: {
    ...process.env,
    AWS_LAMBDA_RUNTIME_API: `127.0.0.1:${server.address().port}`,
    _HANDLER: "apps/media-scanner/dist/handler.handler",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-test",
    AWS_LAMBDA_FUNCTION_VERSION: "$LATEST",
    AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "128"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let diagnostic = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    diagnostic = (diagnostic + data.toString()).slice(-16384);
  });
const exited = once(child, "exit");
child.once("error", rejectResult);
child.once("exit", () => rejectResult(new Error(`Lambda exited before acceptance: ${diagnostic}`)));
const timeout = setTimeout(
  () => rejectResult(new Error(`Lambda acceptance timed out: ${diagnostic}`)),
  20000
);
try {
  await result;
  console.log(
    "Real Lambda bootstrap loaded packaged SDK and denied invalid input without network access."
  );
} finally {
  clearTimeout(timeout);
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(force);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
