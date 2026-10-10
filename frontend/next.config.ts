import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/campaign/:campaignId", destination: "/freight/:campaignId", permanent: true }];
  },
};

export default nextConfig;
