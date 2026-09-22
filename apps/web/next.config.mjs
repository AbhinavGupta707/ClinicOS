const acceptanceBuild = process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Keep the explicitly local acceptance build separate from deployable output.
  ...(acceptanceBuild ? {
    distDir: ".next-mvp-acceptance",
    typescript: { tsconfigPath: ".tsconfig.mvp-acceptance.json" }
  } : {}),
  transpilePackages: ["@clinic-os/ui"],
  async rewrites() {
    const apiUrl = process.env.CLINIC_OS_API_INTERNAL_URL?.trim().replace(/\/+$/u, "");
    if (!apiUrl) return [];

    const parsed = new URL(apiUrl);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
      throw new Error("CLINIC_OS_API_INTERNAL_URL must use http:// or https://");
    }

    return [
      { source: "/health/:path*", destination: `${apiUrl}/health/:path*` },
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` }
    ];
  }
};

export default nextConfig;
