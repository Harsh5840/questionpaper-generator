import type { NextConfig } from "next";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/proxy-api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: "/proxy-socket/:path*",
        destination: `${apiTarget}/socket/:path*`,
      },
    ];
  },
};

export default nextConfig;
