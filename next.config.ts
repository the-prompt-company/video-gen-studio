import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

// Precompiled messages keep the ICU parser out of the browser (+3.3 KB gzip on /login instead of +12 KB, see
// docs/plans/i18n.md Appendix A). The declaration lets `next build` type every t() call's arguments from ko.json.
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
  experimental: {
    createMessagesDeclaration: "./src/messages/ko.json",
    messages: { path: "./src/messages", format: "json", locales: "infer", precompile: true },
  },
});

export default withNextIntl(nextConfig);
