import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/env";

// "Sterling" is a working name: renaming touches this file, APP_NAME and the wordmark only.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "A private money journal in pounds, built for one hand.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0C0D0C",
    theme_color: "#0C0D0C",
    lang: "en-GB",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
