"use client";
import { useState } from "react";
import { formatGBP, toPence } from "@/lib/money";

/** A pounds amount typed as text: raw while editing, "4,400" once left (whole pounds only when there are no pence). */
export function MoneyInput({ value, onChange, label, testId, size = 30, placeholder = "0", align = "right" }: {
  value: string; onChange: (v: string) => void; label: string; testId: string; size?: number; placeholder?: string; align?: "right" | "center";
}) {
  const [focus, setFocus] = useState(false);
  const p = toPence(value);
  const shown = focus || p === null ? value : formatGBP(p, { whole: p % 100 === 0 }).replace(/^£/, "").replace(/^−£?/, "−");
  return (
    <input data-testid={testId} inputMode="decimal" aria-label={label} placeholder={placeholder} value={shown}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value)}
      style={{ width: `${Math.max(2, shown.length + 0.5)}ch`, maxWidth: "100%", textAlign: align, background: "transparent", border: 0, color: "var(--ink)", font: "inherit", fontSize: size, fontWeight: 600, letterSpacing: "-.03em", outline: "none", padding: 0 }} />
  );
}
