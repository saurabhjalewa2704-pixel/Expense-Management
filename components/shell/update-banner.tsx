"use client";
import { useEffect, useRef, useState } from "react";
import { UI } from "@/lib/icons";
import { applyUpdate, watchForUpdate } from "@/lib/sw-update";
import { useBannerSpace } from "./banner-space";

const CHECK_EVERY_MS = 15 * 60_000;

/**
 * A banner at the top whenever a new version of the app is ready (the installed PWA never reloads by itself). It also asks the
 * browser to look for a new version when the app comes back to the foreground, which an iPhone PWA otherwise rarely does.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useBannerSpace(box, !!waiting && !dismissed);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const look = () => { void reg.current?.update().catch(() => {}); };
    void navigator.serviceWorker.getRegistration().then((r) => {
      if (!r || cancelled) return;
      reg.current = r;
      watchForUpdate(r, () => !!navigator.serviceWorker.controller, (w) => { setWaiting(w); setDismissed(false); });
      look();
    });
    const onVisible = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", look);
    const timer = setInterval(look, CHECK_EVERY_MS);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", look); clearInterval(timer); };
  }, []);

  if (!waiting || dismissed) return null;
  return (
    <div ref={box} role="status" className="update-banner" data-testid="update-banner">
      <UI.RefreshCw size={16} strokeWidth={2} aria-hidden />
      <span className="msg">A new version of Sterling is ready.</span>
      <button className="go" disabled={busy} onClick={() => { setBusy(true); if (!applyUpdate(waiting, navigator.serviceWorker, () => window.location.reload())) setBusy(false); }}>{busy ? "Updating…" : "Refresh"}</button>
      <button className="x" aria-label="Dismiss update banner" onClick={() => setDismissed(true)}><UI.X size={16} strokeWidth={2} aria-hidden /></button>
    </div>
  );
}
