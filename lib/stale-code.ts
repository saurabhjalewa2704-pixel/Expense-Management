// An app that has not updated yet talks to a server that has. Server Action ids change with every build, so the old app's calls (edit, delete,
// settings…) are answered "Server Action … was not found on the server". That is not the person's mistake and retrying cannot fix it:
// the app has to switch to the new version. Captures do not depend on this (they use /api/transactions).
import { applyLatestUpdate } from "@/lib/sw-update";

/** The error Next throws on the client when the server does not know the action id. */
export function isStaleCodeError(e: unknown): boolean {
  const err = e as { name?: string; message?: unknown } | null | undefined;
  const msg = typeof err?.message === "string" ? err.message : typeof e === "string" ? e : "";
  return err?.name === "UnrecognizedActionError" || /Server Action\b.*\bwas not found on the server/i.test(msg) || /Failed to find Server Action/i.test(msg);
}

const KEY = "sterling-stale-reload";
/** A reload because of a stale build happens at most once every two minutes, so a server that really is broken cannot loop the app. */
export function mayReloadForNewVersion(now: number, last: number | null): boolean { return last === null || now - last > 120_000; }

/**
 * Drop the stored page, look for the new build and switch to it; with no new worker to wait for, reload so the network supplies the page.
 * Entries waiting to be sent are in IndexedDB, so a reload loses nothing that was saved.
 */
export async function refreshToNewVersion(): Promise<void> {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || null;
    if (!mayReloadForNewVersion(Date.now(), last)) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage unavailable: carry on, the reload is still right */ }
  try { await caches.delete("pages"); } catch { /* no Cache Storage */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => undefined);
      for (let i = 0; i < 16 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 500));
      if (reg.waiting) { applyLatestUpdate(reg, navigator.serviceWorker, () => window.location.reload(), { beforeReload: () => caches.delete("pages") }); return; }
    }
  } catch { /* fall through to a plain reload */ }
  window.location.reload();
}
