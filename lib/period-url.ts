// The Analytics period travels in the URL (`?p=2026-10`) so the detail screens open on the same period, and is kept
// in memory so going back to Analytics restores it. Month `2026-10`, quarter `2026-Q4`, year `2026`, custom `from..to`.
import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { monthStart, type ISODate } from "@/lib/dates";
import type { PeriodSel } from "@/lib/periods";

export function encodePeriod(sel: PeriodSel): string {
  switch (sel.kind) {
    case "month": return sel.anchor.slice(0, 7);
    case "quarter": return `${sel.anchor.slice(0, 4)}-Q${Math.floor((Number(sel.anchor.slice(5, 7)) - 1) / 3) + 1}`;
    case "year": return sel.anchor.slice(0, 4);
    default: return `${sel.custom?.from ?? monthStart(sel.anchor)}..${sel.custom?.to ?? sel.anchor}`;
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function decodePeriod(p: string | null | undefined): PeriodSel | null {
  if (!p) return null;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-(\d{2})$/)) && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { kind: "month", anchor: `${p}-01` };
  if ((m = p.match(/^(\d{4})-Q([1-4])$/))) return { kind: "quarter", anchor: `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0")}-01` };
  if (/^\d{4}$/.test(p)) return { kind: "year", anchor: `${p}-01-01` };
  const [from, to] = p.split("..");
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) return { kind: "custom", anchor: to, custom: { from, to } };
  return null;
}

let shared: PeriodSel | null = null;
/** The period most recently chosen on any Analytics screen (null until one is chosen). */
export const sharedPeriod = () => shared;
export const rememberPeriod = (sel: PeriodSel) => { shared = sel; };
export const periodQuery = (sel: PeriodSel) => `p=${encodePeriod(sel)}`;

/** Period state for the Analytics tab: starts on the last period chosen anywhere in Analytics, else this month. */
export function useSharedPeriod(today: ISODate): [PeriodSel, (s: PeriodSel) => void] {
  const [sel, setSel] = useState<PeriodSel>(() => shared ?? { kind: "month", anchor: today });
  const set = useCallback((s: PeriodSel) => { shared = s; setSel(s); }, []);
  return [sel, set];
}

/** Period state for a detail screen: the URL (`?p=`) carries it, so the arrows rewrite it and Analytics follows. */
export function useUrlPeriod(today: ISODate): [PeriodSel, (s: PeriodSel) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const extra = sp.get("b");
  const sel = decodePeriod(sp.get("p")) ?? shared ?? { kind: "month", anchor: today };
  const set = useCallback((s: PeriodSel) => {
    shared = s;
    router.replace(`${path}?${periodQuery(s)}${extra ? `&b=${extra}` : ""}`, { scroll: false });
  }, [router, path, extra]);
  return [sel, set];
}
