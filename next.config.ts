import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (docker/Dockerfile).
  output: "standalone",
  // PGlite loads its WebAssembly from its own folder: not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  // CSV imports of a few thousand clients go through a server action.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
