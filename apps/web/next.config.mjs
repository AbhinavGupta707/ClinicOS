/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
