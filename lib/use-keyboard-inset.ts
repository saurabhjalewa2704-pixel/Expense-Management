"use client";
import { useEffect, useState } from "react";

/**
 * MOB-09: how far the on-screen keyboard covers the bottom of the layout viewport (iOS Safari does not resize it).
 * Fixed-position sheets add this to their `bottom` so nothing hides behind the keyboard.
 */
export function useKeyboardInset(): { inset: number; viewportHeight: number | null } {
  const [state, setState] = useState<{ inset: number; viewportHeight: number | null }>({ inset: 0, viewportHeight: null });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setState((s) => (s.inset === inset && s.viewportHeight === vv.height ? s : { inset, viewportHeight: vv.height }));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  return state;
}
