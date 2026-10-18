"use client";
import { useEffect, useState } from "react";

/** MOB-05: pull down from the top of the page to refresh (touch only). Returns the current pull distance. */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let startY = 0, active = false, dist = 0;
    const start = (e: TouchEvent) => { if (window.scrollY <= 0) { startY = e.touches[0]!.clientY; active = true; dist = 0; } };
    const move = (e: TouchEvent) => {
      if (!active) return;
      dist = Math.max(0, e.touches[0]!.clientY - startY);
      if (dist > 0) setPull(Math.min(dist * 0.5, 90));
    };
    const end = async () => {
      if (!active) return;
      active = false;
      if (dist * 0.5 >= 64) { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }
      setPull(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); };
  }, [onRefresh]);
  return { pull, refreshing };
}
