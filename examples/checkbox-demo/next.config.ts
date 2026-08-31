import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  transpilePackages: ["@freightonervos/fon-sdk"],
};

export default nextConfig;
