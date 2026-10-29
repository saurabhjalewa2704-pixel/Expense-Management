"use client";
import { useLayoutEffect, type RefObject } from "react";

/**
 * A banner is fixed to the top of the screen, so on its own it would sit over the page's header. While it is showing, it publishes its
 * height as --banner-top and the page content (`.scroll`) starts below it instead of underneath.
 */
export function useBannerSpace(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!active || !el) return;
    const set = () => root.style.setProperty("--banner-top", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--banner-top"); };
  }, [ref, active]);
}
