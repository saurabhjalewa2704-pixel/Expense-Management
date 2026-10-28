"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { InsightCardView, useCardFeedback } from "@/components/insights/insight-card";
import { londonDateOf, formatShort } from "@/lib/dates";
import { useInsightFeedback, useToday, useTripInsightRun } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";
import type { Trip } from "@/lib/types";

/** TRIP-08: two to four cards from the §12 pipeline, scoped to the trip. Opening the overview asks the server whether anything is due. */
export function TripInsights({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const today = useToday();
  const run = useTripInsightRun(trip.id);
  const fb = useInsightFeedback();
  const feedback = useCardFeedback();

  useEffect(() => {
    let live = true;
    const key = `trip.insights.${trip.id}`;
    try { if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 60_000) return; sessionStorage.setItem(key, String(Date.now())); } catch { /* storage unavailable */ }
    void fetch("/api/insights/trip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: trip.id }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { generated?: boolean } | null) => { if (live && j?.generated) void qc.invalidateQueries({ queryKey: qk.tripInsights(trip.id) }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [trip.id, qc]);

  const r = run.data;
  if (!r) return null;
  const dismissed = new Set((fb.data ?? []).filter((f) => f.action === "dismissed" && f.run_id === r.id).map((f) => f.card_key));
  const cards = [...r.cards].sort((a, b) => a.rank - b.rank).filter((c) => !dismissed.has(c.key));
  if (cards.length === 0) return null;
  const on = londonDateOf(r.created_at);
  const when = on === today ? (new Date(r.created_at).getUTCHours() < 12 ? "Updated this morning" : "Updated today") : `Updated ${formatShort(on)}`;
  return (
    <section data-testid="trip-insights">
      <div className="section-h"><h2>Insights</h2><span className="sub">{when}</span></div>
      <div className="stack">{cards.map((c) => <InsightCardView key={c.key} run={r} card={c} onFeedback={(a) => feedback(r, c, a)} />)}</div>
    </section>
  );
}
