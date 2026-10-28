"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { catchUpBills } from "@/app/actions/recurring";
import { useToast } from "@/components/ui/toast";

const EVERY_MS = 20 * 60_000;

/**
 * Logs whatever is due when the app is opened or comes back to the foreground, so bills appear even if the scheduled job
 * is not set up or missed a day. It uses the owner's own session; the scheduled job still sends the notifications.
 */
export function BillsCatchUp() {
  const qc = useQueryClient();
  const toast = useToast();
  const last = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (running.current || Date.now() - last.current < EVERY_MS || (typeof navigator !== "undefined" && !navigator.onLine)) return;
      running.current = true;
      try {
        const r = await catchUpBills();
        if (r.ok) {
          last.current = Date.now();
          if (r.data.logged > 0) {
            await qc.invalidateQueries();
            const shown = r.data.names.slice(0, 3).join(", ");
            toast({ message: `${r.data.logged} bill${r.data.logged === 1 ? "" : "s"} logged: ${shown}${r.data.names.length > 3 ? " and more" : ""}` });
          } else await qc.invalidateQueries({ queryKey: ["profile"] });
        }
      } catch { /* offline or signed out: the next visit tries again */ } finally { running.current = false; }
    };
    void run();
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", run); };
  }, [qc, toast]);
  return null;
}
