"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuickAdd } from "@/components/capture/quick-add";

/**
 * WEB-03, the single owner of keyboard shortcuts so keys cannot collide: `N` new transaction · `/` search ·
 * `G` then `H` / `A` / `N` / `I` go to Home / Activity / Analytics / Insights. Esc is handled by the modals themselves.
 */
export function Shortcuts() {
  const router = useRouter();
  const { open } = useQuickAdd();
  useEffect(() => {
    let g = false, timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]") || document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (g) {
        g = false; clearTimeout(timer);
        const dest = ({ h: "/", a: "/activity", n: "/analytics", i: "/insights" } as Record<string, string>)[k];
        if (dest) { e.preventDefault(); router.push(dest); }
        return;
      }
      if (k === "g") { g = true; timer = setTimeout(() => { g = false; }, 1000); return; }
      if (k === "n") { e.preventDefault(); open(); return; }
      if (k === "/") {
        e.preventDefault();
        const el = document.getElementById("global-search") ?? document.querySelector<HTMLInputElement>("[data-testid=search]");
        if (el) el.focus(); else router.push("/activity");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [router, open]);
  return null;
}
