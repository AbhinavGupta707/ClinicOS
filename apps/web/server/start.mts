import next from "next";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStaffRequestHandler, PRIVATE_HEADERS } from "./request-handler.mts";

// This entrypoint sees socket/header provenance BEFORE Next normalizes a request.
const identity = createStaffRequestHandler(process.env);
const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 3000);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Web port is invalid.");
if (identity.webOrigin && Number(new URL(identity.webOrigin).port || 80) !== port)
  throw new Error("Web listener and registered origin differ.");
const hostname = identity.enabled
  ? "127.0.0.1"
  : (process.env.CLINICOS_WEB_LISTEN_HOST ?? "0.0.0.0");
if (!["127.0.0.1", "0.0.0.0"].includes(hostname)) throw new Error("Web listener host is invalid.");
const application = next({
  dev,
  dir: fileURLToPath(new URL("../", import.meta.url)),
  hostname,
  port
});
await application.prepare();
const handleNext = application.getRequestHandler();
const server = createServer({ maxHeaderSize: 16_384 }, async (request, response) => {
  try {
    if (await identity.handle(request, response)) return;
    if (identity.enabled) {
      const nonce = randomBytes(24).toString("base64url");
      const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
      request.headers["content-security-policy"] = csp;
      request.headers["x-nonce"] = nonce;
      response.setHeader("content-security-policy", csp);
      for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.setHeader(name, value);
    }
    await handleNext(request, response);
  } catch {
    if (!response.headersSent) {
      response.statusCode = 503;
      response.setHeader("cache-control", "no-store");
    }
    response.end("Service unavailable");
  }
});
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5000;
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, resolve);
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  // Stop admission, then drain before closing the stores used by token/session commits.
  const drainDeadline = setTimeout(() => server.closeAllConnections(), 25_000);
  drainDeadline.unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  clearTimeout(drainDeadline);
  const closeDeadline = setTimeout(() => process.exit(1), 10_000);
  closeDeadline.unref();
  await Promise.allSettled([identity.close(), application.close()]);
  clearTimeout(closeDeadline);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
console.log("ClinicOS web listener ready");
