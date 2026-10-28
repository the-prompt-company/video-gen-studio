import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification scaffolding: the verify-video-gen-studio skill starts a second
  // `next dev` on its own port. Next 16 locks on <distDir>/dev/lock, so the
  // verifier sets NEXT_DIST_DIR=.next-verify to coexist with the developer's server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
