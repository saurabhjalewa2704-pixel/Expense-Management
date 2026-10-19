"use client";
import { useEffect, useRef, useState } from "react";

/** MOB-06: count to a new value over 400 ms with an ease-out curve; the first value is shown as-is. */
export function useAnimatedNumber(target: number | undefined, duration = 400): number | undefined {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (target === undefined) return;
    const start = from.current;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (start === undefined || start === target || reduce) { from.current = target; setShown(target); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      from.current = v;
      setShown(v);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return shown;
}
