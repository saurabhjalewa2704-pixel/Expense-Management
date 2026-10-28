"use client";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { submitFeedback } from "@/app/actions/insights";
import { Sparkline } from "@/components/charts/sparkline";
import type { Card as CardT } from "@/lib/ai/types";
import type { InsightRunRow } from "@/lib/ai/generate";
import { UI } from "@/lib/icons";
import { qk } from "@/lib/queries/keys";
import { useInsightFeedback, useInsightRuns } from "@/lib/queries/hooks";
import { formatGBP } from "@/lib/money";

const TAG: Record<CardT["type"], string> = {
  pace: "Pace", anomaly: "Unusual", trend: "Trend", subscription: "Subscriptions", new_payee: "New payee", win: "Going well", suggestion: "Suggestion",
  trip_pace: "Trip pace", trip_mix: "Where it's going", trip_stop: "By stop", trip_compare: "Past trips", trip_big: "Biggest expense", trip_fx: "Card fees",
};

function href(card: CardT): string | null {
  const l = card.link;
  if (!l) return null;
  if (l.kind === "category") return `/analytics/category/${l.id}`;
  if (l.kind === "payee") return `/activity?payee=${l.id}`;
  return l.id.startsWith("/") ? l.id : null;
}

/** One insight. Every figure shown is a grounded fact's own display string, or drawn from that fact's stored value. */
export function InsightCardView({ run, card, onFeedback }: { run: InsightRunRow; card: CardT; onFeedback?: (a: "helpful" | "dismissed" | "opened") => void }) {
  const facts = new Map(run.facts.facts.map((f) => [f.key, f]));
  const m = card.metric ? facts.get(card.metric.fact_key) : undefined;
  const d = card.metric?.delta_fact_key ? facts.get(card.metric.delta_fact_key) : undefined;
  const tone = card.severity === "caution" ? "cau" : card.severity === "positive" ? "pos" : "";
  const Icon = card.type === "win" ? UI.Check : card.type === "subscription" ? UI.RefreshCw : UI.Sparkles;
  const labels = card.type === "pace" ? ["This month", "Last month"] : card.type === "trend" ? ["Latest", "Earlier"] : ["So far", "Typical"];
  const to = href(card);
  const [done, setDone] = useState<"helpful" | null>(null);
  const hi = card.viz === "bar_compare" && m?.value_pence != null && d?.value_pence != null ? Math.max(m.value_pence, d.value_pence, 1) : 1;
  return (
    <article className="card insight" data-testid="insight-card" data-key={card.key}>
      <span className={`ins-tag ${tone}`}><Icon size={14} strokeWidth={2} aria-hidden />{TAG[card.type]}</span>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      {card.viz === "bar_compare" && m?.value_pence != null && d?.value_pence != null && (
        <div className="compare" aria-label={`${m.label}: ${formatGBP(m.value_pence)}; ${d.label}: ${formatGBP(d.value_pence)}`}>
          <span className="lab" style={{ whiteSpace: "nowrap" }}>{labels[0]}</span><div className={`bar ${tone === "cau" ? "cau" : ""}`} style={{ width: `${(m.value_pence / hi) * 100}%` }} /><span className="num">{m.display}</span>
          <span className="lab" style={{ whiteSpace: "nowrap" }}>{labels[1]}</span><div className="bar ctx" style={{ width: `${(d.value_pence / hi) * 100}%` }} /><span className="num">{d.display}</span>
        </div>
      )}
      {card.viz === "spark" && m?.series && m.series.length > 1 && <div style={{ marginTop: 14 }}><Sparkline values={m.series} height={48} label={`${m.label} over time`} /></div>}
      {onFeedback && (
        <div className="ins-actions">
          <button className="ghost" aria-label="Helpful" aria-pressed={done === "helpful"} onClick={() => { setDone("helpful"); onFeedback("helpful"); }}><UI.Check size={16} strokeWidth={1.75} aria-hidden />{done === "helpful" ? "Thanks" : "Helpful"}</button>
          <button className="ghost" aria-label="Dismiss" onClick={() => onFeedback("dismissed")}><UI.X size={16} strokeWidth={1.75} aria-hidden />Dismiss</button>
          {to && <Link className="ghost open" href={to} onClick={() => onFeedback("opened")}>View <UI.ChevronRight size={14} strokeWidth={1.75} aria-hidden /></Link>}
        </div>
      )}
    </article>
  );
}


/** Feedback handler bound to a run: records it, then refreshes the cached feedback so a dismissed card disappears at once. */
export function useCardFeedback() {
  const qc = useQueryClient();
  return async (run: InsightRunRow, card: CardT, action: "helpful" | "dismissed" | "opened") => {
    if (action === "dismissed") {
      qc.setQueryData<{ run_id: string; card_key: string; card_type: string; action: string }[]>([...qk.insights, "feedback"], (old) => [{ run_id: run.id, card_key: card.key, card_type: card.type, action }, ...(old ?? [])]);
    }
    const r = await submitFeedback({ run_id: run.id, card_key: card.key, card_type: card.type, action });
    if (!r.ok) await qc.invalidateQueries({ queryKey: [...qk.insights, "feedback"] });
  };
}

/** Cards from the newest run that the user hasn't dismissed, best first. */
export function useVisibleCards() {
  const runs = useInsightRuns(), fb = useInsightFeedback();
  const run = runs.data?.[0];
  const dismissed = new Set((fb.data ?? []).filter((f) => f.action === "dismissed").map((f) => f.card_key));
  const cards = run ? [...run.cards].sort((a, b) => a.rank - b.rank).filter((c) => !dismissed.has(c.key)) : [];
  return { run, cards, loading: runs.isLoading };
}

/** Home (one card) and the desktop rail (up to three). */
export function InsightCard({ variant }: { variant: "home" | "list" }) {
  const visible = useVisibleCards();
  const { run } = visible;
  const cards = variant === "home" ? visible.cards.filter((c) => c.type !== "pace") : visible.cards;   // Home already has the pace card
  const feedback = useCardFeedback();
  if (!run || cards.length === 0) return null;
  const shown = variant === "home" ? cards.slice(0, 1) : cards.slice(0, 3);
  return (
    <>
      {shown.map((c) => <InsightCardView key={c.key} run={run} card={c} onFeedback={(a) => feedback(run, c, a)} />)}
      <Link className="link" href="/insights" style={{ alignSelf: "flex-start" }}>See all insights</Link>
    </>
  );
}
