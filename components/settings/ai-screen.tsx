"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clearAiHistory, getAiUsage } from "@/app/actions/insights";
import { updateProfile } from "@/app/actions/profile";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";

const n = (x: number) => new Intl.NumberFormat("en-GB").format(x);

/** SET-04: switch insights off, choose whether notes may be sent, see usage against the monthly cap, clear history. */
export function AiScreen() {
  const profile = useProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: async () => { const r = await getAiUsage(); if (!r.ok) throw new Error(r.error); return r.data; } });
  const [confirmClear, setConfirmClear] = useState(false);
  const set = async (patch: Record<string, boolean>) => {
    const r = await updateProfile(patch);
    if (!r.ok) toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries({ queryKey: qk.profile });
  };
  const p = profile.data;
  const pct = usage.data ? Math.min(100, Math.round((usage.data.used / usage.data.cap) * 100)) : 0;
  return (
    <div className="scroll">
      <PageHeader title="AI insights" back="/settings" backLabel="Settings" />
      <p className="sub" style={{ marginTop: 6 }}>Sterling works out every number itself. The AI only turns those numbers into a few plain sentences, and any sentence that quotes a figure it wasn&rsquo;t given is discarded.</p>
      <div className="list" style={{ marginTop: 20 }}>
        <div className="row"><div className="row-main"><div className="row-t">Insights and Ask Sterling</div><div className="row-s">Digests on Monday and the 1st, and questions in your own words</div></div>
          <Switch label="AI insights" checked={p?.ai_enabled ?? true} onChange={(v) => set({ ai_enabled: v })} /></div>
        <div className="row"><div className="row-main"><div className="row-t">Include transaction notes</div><div className="row-s">Off by default. Notes can contain personal detail</div></div>
          <Switch label="Include transaction notes" checked={p?.ai_include_notes ?? false} onChange={(v) => set({ ai_include_notes: v })} disabled={p?.ai_enabled === false} /></div>
      </div>
      <div className="section-h"><h2>What is sent</h2></div>
      <p className="sub">Category totals, comparisons and payee names for the period, never account numbers, balances you didn&rsquo;t ask about, or your e-mail address.{usage.data && !usage.data.live ? " No API key is configured on this server, so insights are written from templates." : ""}</p>
      <div className="section-h"><h2>This month&rsquo;s usage</h2></div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row-between"><span data-testid="ai-usage">{usage.data ? `${n(usage.data.used)} of ${n(usage.data.cap)} tokens` : "…"}</span><span className="sub">{pct}%</span></div>
        <div role="progressbar" aria-label="Monthly AI usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 6, borderRadius: 3, background: "var(--surface-3)", marginTop: 10, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--ink)" }} />
        </div>
        <p className="sub" style={{ marginTop: 10 }}>Digests and Ask Sterling answers both count. At the cap digests use templates and questions pause until next month.</p>
      </div>
      <div className="list" style={{ marginTop: 28 }}>
        {confirmClear ? (
          <div className="row"><div className="row-main"><div className="row-t">Clear all AI history?</div><div className="row-s">Removes past insights and your feedback on them</div></div>
            <button className="ghost" style={{ color: "var(--danger)", fontWeight: 600, padding: "0 12px", height: 36 }} onClick={async () => { const r = await clearAiHistory(); setConfirmClear(false); if (!r.ok) return toast({ message: r.error, tone: "error" }); await qc.invalidateQueries({ queryKey: qk.insights }); await usage.refetch(); toast({ message: "AI history cleared" }); }}>Clear</button></div>
        ) : (
          <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setConfirmClear(true)}><div className="row-main"><div className="row-t" style={{ color: "var(--danger)" }}>Clear AI history</div></div></button>
        )}
      </div>
    </div>
  );
}
