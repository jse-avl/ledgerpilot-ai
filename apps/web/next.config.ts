import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages ship raw TypeScript; Next transpiles them in place.
  transpilePackages: ["@ledgerpilot/core", "@ledgerpilot/db", "@ledgerpilot/agent"],

  // Playwright and curl reach the dev server on the loopback IP rather than
  // `localhost`. Next treats that as a foreign origin and refuses its own dev
  // resources, which makes the browser retry the page in a loop. Listing the
  // IP keeps the development experience the same on both hostnames.
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
