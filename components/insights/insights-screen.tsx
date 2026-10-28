"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AskDock } from "@/components/insights/ask-screen";
import { InsightCardView, useCardFeedback } from "@/components/insights/insight-card";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import type { InsightRunRow } from "@/lib/ai/generate";
import { UI } from "@/lib/icons";
import { useInsightFeedback, useInsightRuns, useProfile, useTransactionCount } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";

type Tab = "weekly" | "monthly" | "adhoc";
const TABS: { id: Tab; label: string }[] = [{ id: "weekly", label: "Last week" }, { id: "monthly", label: "Last month" }, { id: "adhoc", label: "So far" }];

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/,\s*/g, " ").replace(/(\d{2}:\d{2})$/, ", $1");

export function InsightsScreen() {
  const runs = useInsightRuns(), fb = useInsightFeedback(), profile = useProfile(), count = useTransactionCount();
  const qc = useQueryClient();
  const toast = useToast();
  const feedback = useCardFeedback();
  const [picked, setPicked] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);

  const byScope = (s: Tab): InsightRunRow | undefined => runs.data?.find((r) => r.scope === s);
  const tab: Tab = picked ?? (runs.data?.[0]?.scope as Tab | undefined) ?? "adhoc";
  const run = byScope(tab);
  const dismissed = new Set((fb.data ?? []).filter((f) => f.action === "dismissed").map((f) => f.card_key));
  const cards = run ? [...run.cards].sort((a, b) => a.rank - b.rank).filter((c) => !dismissed.has(c.key)) : [];
  const off = profile.data?.ai_enabled === false;

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/insights", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) { toast({ message: body.error ?? "We couldn't refresh your insights.", tone: "error" }); return; }
      await qc.invalidateQueries({ queryKey: qk.insights });
      setPicked("adhoc");
    } catch { toast({ message: "You're offline. Insights refresh when you're back online." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="scroll ask-scroll">
      <PageHeader title="Insights" back="/" backLabel="Home" right={
        <button className="icon-btn" aria-label="Refresh insights" disabled={busy || off} onClick={refresh}><UI.RefreshCw size={18} strokeWidth={1.75} aria-hidden className={busy ? "spin" : undefined} /></button>
      } />
      <div className="sub" style={{ marginTop: 6 }}>{run ? `Updated ${stamp(run.created_at)} · from your own data` : "From your own data"}</div>
      <div className="seg" role="tablist" aria-label="Insight period" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setPicked(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        {off ? (
          <p className="sub">AI insights are switched off. Turn them on in Settings → AI insights.</p>
        ) : count.data !== undefined && count.data < 10 ? (
          <div className="card" data-testid="insights-too-few"><h3 style={{ fontWeight: 600 }}>Not much to go on yet</h3><p className="sub" style={{ marginTop: 6 }}>Log a few more days and insights will appear.</p></div>
        ) : runs.isLoading ? (
          <div className="card" aria-busy><div className="skeleton" style={{ height: 120 }} /></div>
        ) : !run ? (
          <div className="card"><h3 style={{ fontWeight: 600 }}>Nothing here yet</h3><p className="sub" style={{ marginTop: 6 }}>Digests arrive on Monday mornings and on the 1st. Tap refresh to see where you stand now.</p></div>
        ) : cards.length === 0 ? (
          <p className="sub">You&rsquo;ve dismissed everything here. Refresh for a new look.</p>
        ) : (
          cards.map((c) => <InsightCardView key={c.key} run={run} card={c} onFeedback={(a) => feedback(run, c, a)} />)
        )}
      </div>
      {run?.stale && <p className="sub" data-testid="insights-stale" style={{ marginTop: 12, textAlign: "center" }}>You added something to this period afterwards. These cards may be out of date; the next refresh updates them.</p>}
      {run && (run.model.startsWith("template") || run.used_fallback) && <p className="sub" data-testid="insights-paused" style={{ marginTop: 8, textAlign: "center" }}>AI summary paused. These cards are written from your numbers directly.</p>}
      {run && <p className="sub" style={{ marginTop: 20, textAlign: "center" }}>Generated from your data · {run.period_start === run.period_end ? run.period_start : `${run.period_start} to ${run.period_end}`}</p>}
      {!off && <AskDock />}
    </div>
  );
}
