import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// The browser talks to Supabase directly (RLS-protected reads), so its exact origin is allowed, not a wildcard.
const supabaseOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return ""; } })();
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

// The release number shown at the bottom of Settings: package.json "version", bumped with every release. The build id (the commit on Vercel)
// and the build date change by themselves with every deployment, so two phones can always tell whether they run the same build.
const releaseVersion: string = (() => { try { return (JSON.parse(readFileSync("package.json", "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; } })();
const builtOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim() + (process.env.NODE_ENV === "production" ? "" : " ws://localhost:*"),
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Every deployment gets its own id, which the persisted query cache uses as its "buster": data cached by an older version is
  // thrown away instead of being rendered by newer code that expects a different shape.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? "dev", NEXT_PUBLIC_APP_VERSION: releaseVersion, NEXT_PUBLIC_BUILT_ON: builtOn },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      { source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default withSerwist(nextConfig);
