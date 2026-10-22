import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Studio moved from /pulse to /; query (?run=) is preserved by Next redirects.
  async redirects() {
    return [{ source: "/pulse", destination: "/", permanent: false }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
