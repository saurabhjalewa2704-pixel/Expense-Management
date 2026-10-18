"use client";
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
/** WEB-01: ≥1024px is the desktop layout (sidebar, centred modals). */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
