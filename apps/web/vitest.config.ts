import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": rootDir
    }
  },
  test: {
    // Legacy workflow contract tests exercise the explicit synthetic transport.
    // staff-session.test.ts separately exercises the default cookie/CSRF transport.
    env: { NEXT_PUBLIC_CLINIC_OS_ENV: "local", NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT: "synthetic_bearer" },
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"]
  }
});
