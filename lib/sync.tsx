"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { flushOutbox, purgeConfirmed } from "@/lib/outbox";

const EVENT = "sterling:sync";
/** Ask the sync engine to flush the outbox now (after a capture). */
export const requestSync = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); };

/**
 * Flushes the outbox on launch, when the network returns and when the app regains focus (iOS has no Background Sync),
 * then refreshes every active query so the server's figures replace the optimistic ones. It flushes BEFORE refetching,
 * so a refetch can never overwrite an optimistic entry that has not reached the server yet.
 */
export function SyncEngine() {
  const qc = useQueryClient();
  useEffect(() => {
    let running = false;
    let again = false;
    const run = async (refresh: boolean) => {
      if (running) { again = true; return; }
      running = true;
      try {
        const r = await flushOutbox();
        if (r.confirmed > 0 || (refresh && !r.blocked)) await qc.invalidateQueries();
        if (r.confirmed > 0) await purgeConfirmed();
      } catch {
        /* offline: the next trigger retries */
      } finally {
        running = false;
        if (again) { again = false; void run(false); }
      }
    };
    const onSync = () => void run(false);
    // EC-C11: flush on every successful network call too: Safari can evict local data, so queued entries should not wait for the next launch
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "success") { clearTimeout(timer); timer = setTimeout(() => void run(false), 1500); }
    });
    const onOnline = () => void run(true);
    const onVisible = () => { if (document.visibilityState === "visible") void run(true); };
    window.addEventListener(EVENT, onSync);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void run(false);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener(EVENT, onSync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc]);
  return null;
}
