"use client";
// PRD §6.13 BUD-02 (mock-up 29): edit one category limit: the amount, six months of that category against it, applies-from, roll over, remove.
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { formatMonthShort, monthStart } from "@/lib/dates";
import { formatGBP, medianPence, toPence } from "@/lib/money";
import { useCategoryMonthly, useToday } from "@/lib/queries/hooks";

const whole = (p: number) => formatGBP(p, { whole: true });
const ceilTo = (p: number, step: number) => Math.max(step, Math.ceil(p / step) * step);

export interface LimitDraft { amount: number; rollover: boolean }

/** Quick amounts: the usual spend, then round figures above it. */
export function amountChips(usual: number | null): { label: string; pence: number }[] {
  if (!usual || usual <= 0) return [10000, 20000, 30000, 50000].map((p) => ({ label: whole(p), pence: p }));
  const u = Math.round(usual / 1000) * 1000 || 1000;
  const a = ceilTo(u * 1.15, 5000), b = ceilTo(u * 1.5, 10000), c = ceilTo(u * 2, 10000);
  const set = [...new Set([a, b, c])].filter((x) => x !== u).slice(0, 3);
  return [{ label: `${whole(usual)} usual`, pence: u }, ...set.map((p) => ({ label: whole(p), pence: p }))];
}

export function LimitSheet({ open, onOpenChange, name, categoryId, usual, draft, existing, onSave, onRemove }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; categoryId: string; usual: number | null;
  draft: LimitDraft | null; existing: boolean; onSave: (d: LimitDraft) => void; onRemove: () => void;
}) {
  const today = useToday();
  const monthly = useCategoryMonthly(categoryId, 6, true);
  const [text, setText] = useState("");
  const [roll, setRoll] = useState(false);
  useEffect(() => { if (open) { setText(draft ? String(draft.amount / 100) : usual ? String(Math.round(usual / 1000) * 10) : ""); setRoll(draft?.rollover ?? false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pence = toPence(text);
  const valid = pence !== null && pence > 0;
  const cur = monthStart(today);
  const bars = (monthly.data ?? []).slice(-6);
  const prior = bars.filter((b) => b.month < cur);
  const maxV = Math.max(1, ...bars.map((b) => b.total_pence), valid ? pence! : 0);
  const under = valid ? prior.filter((b) => b.total_pence <= pence!).length : 0;
  const finding = !valid || prior.length === 0 ? `${name} by month`
    : under === prior.length ? `Under ${whole(pence!)} in each of the last ${prior.length} months`
    : `Over ${whole(pence!)} in ${prior.length - under} of the last ${prior.length} months`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${name} limit`} nested>
      <div className="vaul-body" data-testid="limit-sheet">
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button>
          <span className="t">{name} limit</span>
          <button className="txt" data-testid="limit-save" style={{ color: "var(--ink)", fontWeight: 600, opacity: valid ? 1 : 0.4 }} disabled={!valid} onClick={() => { onSave({ amount: pence!, rollover: roll }); onOpenChange(false); }}>Save</button>
        </div>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "baseline", fontSize: 48, fontWeight: 600, letterSpacing: "-.04em" }}>
            <span style={{ fontSize: 24, color: "var(--ink-2)", marginRight: 3 }}>£</span>
            <input data-testid="limit-amount" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label={`${name} monthly limit`} style={{ width: `${Math.max(2, text.length + 0.5)}ch`, background: "transparent", border: 0, color: "var(--ink)", font: "inherit", textAlign: "center", outline: "none" }} />
          </label>
          <div className="sub">a month{usual ? ` · usual ${whole(usual)}` : ""}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            {amountChips(usual).map((c) => <button key={c.label} className={`chip plain ${valid && pence === c.pence ? "sel" : ""}`} onClick={() => setText(String(c.pence / 100))}>{c.label}</button>)}
          </div>
        </div>
        <div className="bg-card" style={{ marginTop: 16, background: "var(--surface-2)" }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{finding}</div>
          <div className="sub" style={{ marginTop: 4 }}>{name} by month · line = this limit</div>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, 1fr)`, gap: 10, alignItems: "end", height: 130, marginTop: 14 }} role="img" aria-label={finding}>
            {valid && <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(pence! / maxV) * 100 * 0.78 + 14}px`, borderTop: "1.5px dashed var(--ink)" }} aria-hidden />}
            {bars.map((b) => (
              <div key={b.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }}>
                <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{whole(b.total_pence)}</span>
                <div style={{ width: "100%", height: `${(b.total_pence / maxV) * 78}%`, minHeight: 2, borderRadius: "5px 5px 2px 2px", background: b.month === cur ? (valid && b.total_pence > pence! ? "var(--caution)" : "var(--ink)") : "var(--chart-context)" }} />
                <span style={{ fontSize: 11, color: b.month === cur ? "var(--ink)" : "var(--ink-3)", fontWeight: b.month === cur ? 600 : 400 }}>{formatMonthShort(b.month)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="list" style={{ background: "var(--surface-2)", borderRadius: 12, marginTop: 12, padding: "0 16px" }}>
          <div className="row-between" style={{ minHeight: 50 }}><span>Applies from</span><span className="sub">{existing ? "Chosen when you save" : "This month"}</span></div>
          <div className="row-between" style={{ minHeight: 56, borderTop: "1px solid var(--rule)" }}>
            <div><div>Roll over unspent</div><div className="sub" style={{ fontSize: 13 }}>Leftover carries into next month’s limit</div></div>
            <Switch checked={roll} onChange={setRoll} label="Roll over unspent" />
          </div>
        </div>
        {existing && <button className="link" data-testid="limit-remove" style={{ display: "block", margin: "18px auto 8px", color: "var(--danger)", fontSize: 17 }} onClick={() => { onRemove(); onOpenChange(false); }}>Remove limit</button>}
      </div>
    </Sheet>
  );
}
