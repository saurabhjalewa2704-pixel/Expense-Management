"use client";
import { useEffect, useRef, useState } from "react";
import { UI } from "@/lib/icons";
import { applyUpdate, watchForUpdate } from "@/lib/sw-update";

type State = "checking" | "current" | "ready" | "offline";

/** The release number, the build it came from, and whether a newer version is waiting (the same check the update banner uses). */
export function AppVersion() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const build = (process.env.NEXT_PUBLIC_BUILD_ID ?? "dev").slice(0, 7);
  const builtOn = process.env.NEXT_PUBLIC_BUILT_ON;
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const waiting = useRef<ServiceWorker | null>(null);

  const check = async () => {
    setState("checking");
    const r = reg.current;
    if (!r) { setState("current"); return; }                                 // no service worker (a browser tab in development): nothing to compare with
    try {
      await r.update();
      for (let i = 0; i < 16 && !r.waiting; i++) await new Promise((ok) => setTimeout(ok, 500));   // a new build needs a moment to install
      if (r.waiting) { waiting.current = r.waiting; setState("ready"); } else setState("current");
    } catch { setState("offline"); }
  };

  useEffect(() => {
    let live = true;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) { setState("current"); return; }
    void navigator.serviceWorker.getRegistration().then((r) => {
      if (!live) return;
      reg.current = r;
      if (!r) { setState("current"); return; }
      watchForUpdate(r, () => !!navigator.serviceWorker.controller, (w) => { waiting.current = w; if (live) setState("ready"); });
      if (!r.waiting) void check();
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = state === "checking" ? "Checking for updates…" : state === "ready" ? "A newer version is ready" : state === "offline" ? "Couldn’t check. You’re offline." : "You’re on the latest version";
  return (
    <div className="list" data-testid="app-version">
      <div className="row">
        <div className="tile"><UI.Info size={20} strokeWidth={1.75} aria-hidden /></div>
        <div className="row-main">
          <div className="row-t" data-testid="version-number">Sterling {version}</div>
          <div className="row-s" data-testid="version-build">Build {build}{builtOn ? ` · ${builtOn}` : ""}</div>
        </div>
      </div>
      {state === "ready" ? (
        <button className="row" style={{ width: "100%", textAlign: "left" }} disabled={busy} data-testid="version-refresh"
          onClick={() => { setBusy(true); if (!applyUpdate(waiting.current, navigator.serviceWorker, () => window.location.reload())) setBusy(false); }}>
          <div className="tile"><UI.RefreshCw size={20} strokeWidth={1.75} aria-hidden /></div>
          <div className="row-main"><div className="row-t" data-testid="version-status">{busy ? "Updating…" : status}</div><div className="row-s">Tap to refresh and switch to it</div></div>
        </button>
      ) : (
        <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => void check()} disabled={state === "checking"} data-testid="version-check">
          <div className="tile">{state === "current" ? <UI.Check size={20} strokeWidth={1.75} aria-hidden /> : <UI.RefreshCw size={20} strokeWidth={1.75} aria-hidden />}</div>
          <div className="row-main"><div className="row-t" data-testid="version-status">{status}</div><div className="row-s">Tap to check again</div></div>
        </button>
      )}
    </div>
  );
}
