"use client";
// CASH-06 (mock-ups 06 and 10): "On track to close October at about £3,139", from the one forecast engine. Tapping it explains the sum.
import { useState } from "react";
import { ForecastWhySheet } from "@/components/budget/forecast-why";
import { formatDayMonth, formatMonth, monthEnd, monthStart } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useMonthForecast, useProjectedClose, useToday } from "@/lib/queries/hooks";

export function MonthOutlook() {
  const p = useProjectedClose();
  const [why, setWhy] = useState(false);
  if (p.value === null) return null;
  return (
    <>
      <button className="card" data-testid="month-outlook" onClick={() => setWhy(true)} aria-label="Why this projection?"
        style={{ background: "var(--ink)", color: "var(--on-ink)", padding: 22, textAlign: "left", display: "block", width: "100%" }}>
        <span className="row-between"><span className="eyebrow" style={{ color: "var(--on-ink)", opacity: 0.7, display: "flex", gap: 6, alignItems: "center" }}><UI.Sparkles size={14} strokeWidth={2} aria-hidden />Month outlook</span>
          <span style={{ fontSize: 13, opacity: 0.6 }}>{p.forecast ? `${p.forecast.dom} of ${p.forecast.daysInMonth} days` : ""}</span></span>
        <span style={{ display: "block", fontSize: 21, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.25, marginTop: 10 }} data-testid="outlook-text">
          {p.value < 0 ? `On course to end ${formatMonth(p.month)} overdrawn by about ${formatGBP(-p.value, { whole: true })}` : `On track to close ${formatMonth(p.month)} at about ${formatGBP(p.value, { whole: true })}`}
        </span>
        <span style={{ display: "block", fontSize: 13, opacity: 0.6, marginTop: 8 }}>Projected close, {formatDayMonth(monthEnd(p.month))}</span>
      </button>
      <ForecastWhySheet open={why} onOpenChange={setWhy} month={p.month} />
    </>
  );
}

/** EC-F24 (mock-up F4, 7): when this month's ratio is clamped at 2.5, say so, rather than showing an extreme forecast. */
export function FarAboveUsual() {
  const today = useToday();
  const q = useMonthForecast(monthStart(today));
  const f = q.data?.forecast;
  if (!f || f.regime === "actual" || f.evidence.ratioUsed < 2.5) return null;
  return (
    <div className="card insight" data-testid="far-above-usual">
      <span className="ins-tag cau"><UI.Sparkles size={14} strokeWidth={2} aria-hidden />Insight</span>
      <h3>This month is running well above anything usual</h3>
      <p>Over 2.5× your usual pace so far. The forecast caps the effect at 2.5× until more days confirm it.</p>
    </div>
  );
}
