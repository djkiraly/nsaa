import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep classic dynamic rendering semantics (route segment config, force-dynamic, etc.)
  cacheComponents: false,
  // Let other devices on the LAN load dev-only resources (fonts, HMR)
  allowedDevOrigins: ["192.168.7.143"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
