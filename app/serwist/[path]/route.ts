import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker at /serwist/sw.js, bundled from app/sw.ts with a precache manifest of the built assets.
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/offline", revision }],
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
});
