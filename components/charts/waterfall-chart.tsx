"use client";
import { motion } from "motion/react";
import { formatGBP } from "@/lib/money";
import type { WaterfallStep } from "@/lib/analytics";

/** AN-03: how opening cash became available cash. Bars start at `base` (a broken scale, stated in the subtitle). */
export function WaterfallChart({ steps, base }: { steps: WaterfallStep[]; base: number }) {
  const hi = Math.max(...steps.flatMap((s) => [s.from, s.to]));
  const span = Math.max(1, hi - base);
  return (
    <div data-testid="waterfall" style={{ marginTop: 14 }} role="list">
      {steps.map((s) => {
        const lo = Math.min(s.from || base, s.to), up = Math.max(s.from || base, s.to);
        const left = s.kind === "total" ? 0 : (Math.max(0, lo - base) / span) * 100;
        const width = s.kind === "total" ? (Math.max(0, s.to - base) / span) * 100 : Math.max(1.2, ((up - Math.max(lo, base)) / span) * 100);
        const color = s.kind === "total" ? "var(--ink)" : s.kind === "up" ? "var(--positive)" : "var(--chart-context)";
        return (
          <div key={s.key} role="listitem" style={{ display: "grid", gridTemplateColumns: "84px 1fr 86px", alignItems: "center", gap: 8, height: 26 }} aria-label={`${s.label} ${formatGBP(s.value, { signed: s.kind !== "total" })}`}>
            <span style={{ fontSize: 13, color: s.kind === "total" ? "var(--ink)" : "var(--ink-2)", fontWeight: s.kind === "total" ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
            <div style={{ position: "relative", height: 14 }} aria-hidden>
              <motion.div initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ type: "spring", duration: 0.28, bounce: 0 }}
                style={{ position: "absolute", left: `${left}%`, top: 0, bottom: 0, borderRadius: 3, background: color }} />
            </div>
            <span className={`num ${s.kind === "up" ? "pos" : ""}`} style={{ fontSize: 13, textAlign: "right", fontWeight: s.kind === "total" ? 600 : 400 }}>{formatGBP(s.value, { signed: s.kind === "up" })}</span>
          </div>
        );
      })}
    </div>
  );
}
