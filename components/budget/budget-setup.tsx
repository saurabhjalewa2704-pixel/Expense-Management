"use client";
// PRD §6.13 BUD-01/02/10 (mock-up 28): set the monthly budget, what it covers, optional L1 limits, and the alerts.
import { useQueries, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { saveBudgets, setBudgetOverride } from "@/app/actions/budget";
import { updateProfile } from "@/app/actions/profile";
import { LimitSheet, type LimitDraft } from "@/components/budget/limit-sheet";
import { MoneyInput } from "@/components/budget/money-input";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { COVERS_LABEL, type Covers } from "@/lib/budget";
import { formatMonthYear, monthStart } from "@/lib/dates";
import { fetchCategoryMonthly } from "@/lib/queries/fetchers";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP, medianPence, toPence } from "@/lib/money";
import { qk } from "@/lib/queries/keys";
import { useBudgetRows, useCategoryTree, useMonthlyTotals, useProfile, useRecurringItems, useToday } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";

const whole = (p: number) => formatGBP(p, { whole: true });

export function BudgetSetup() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const month = monthStart(today);
  const { tree } = useCategoryTree();
  const saved = useBudgetRows(month);
  const profile = useProfile().data;
  const parents = tree.parents("expense");
  const track = profile?.tracking_started_on ?? null;

  // what each category usually costs: the median of the earlier full months we have (BUD-01 setup hints)
  const usualQs = useQueries({ queries: parents.map((c) => ({ queryKey: qk.categoryMonthly(c.id, 7, true), queryFn: () => fetchCategoryMonthly(supabaseBrowser(), c.id, 7, true) })) });
  const usuals = (() => {
    const m = new Map<string, number | null>();
    parents.forEach((c, i) => {
      const rows = (usualQs[i]?.data ?? []).filter((r) => r.month < month && (!track || r.month > monthStart(track)));
      m.set(c.id, rows.length >= 2 ? medianPence(rows.map((r) => r.total_pence)) : null);
    });
    return m;
  })();

  const [amountText, setAmountText] = useState("");
  const [covers, setCovers] = useState<Covers>("all");
  const [limits, setLimits] = useState<Map<string, LimitDraft>>(new Map());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const sp0 = useSearchParams();
  const [from, setFrom] = useState<"this" | "next">(sp0.get("from") === "next" ? "next" : "this");      // month close step 6 opens it for next month
  const [ready, setReady] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [coversOpen, setCoversOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  // BUD-12 budget_suggest: the card opens the limit with the proposed amount filled in; nothing changes until Save is tapped
  const sp = useSearchParams();
  const suggestCat = sp.get("limit"), suggestAmt = Number(sp.get("amount") ?? 0);
  useEffect(() => { if (ready && suggestCat && suggestAmt > 0 && tree.byId.has(suggestCat)) { setLimits((m) => (m.has(suggestCat) && m.get(suggestCat)!.amount === suggestAmt ? m : new Map(m).set(suggestCat, { amount: suggestAmt, rollover: m.get(suggestCat)?.rollover ?? false }))); setEdit(suggestCat); } }, [ready, suggestCat, suggestAmt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready || !saved.data) return;
    const o = saved.data.find((r) => r.category_id === null);
    if (o) { setAmountText(String(o.base_pence / 100)); setCovers(o.covers); }
    setLimits(new Map(saved.data.filter((r) => r.category_id).map((r) => [r.category_id!, { amount: r.base_pence, rollover: r.rollover }])));
    setReady(true);
  }, [saved.data, ready]);

  const hadBudget = !!saved.data?.some((r) => r.category_id === null);
  const overallOverride = saved.data?.find((r) => r.category_id === null)?.override_pence ?? null;
  const amount = toPence(amountText);
  const limitsTotal = [...limits.values()].reduce((s, l) => s + l.amount, 0);
  const left = amount ? amount - limitsTotal : null;

  // "You've spent £X a month on average…": complete months after tracking began
  const totals = useMonthlyTotals(12).data ?? [];
  const items = useRecurringItems().data ?? [];
  const done = totals.filter((t) => t.month < month && t.spend_pence > 0 && (!track || t.month > monthStart(track)));
  const avg = done.length >= 2 ? Math.round(done.reduce((s, t) => s + t.spend_pence, 0) / done.length) : null;
  const bills = items.filter((i) => i.type === "expense" && !i.ended_at && !i.paused_at && i.frequency === "monthly").reduce((s, i) => s + i.amount_pence, 0);

  const dirty = ready && (!hadBudget ? !!amount : true);
  const save = async () => {
    if (!amount) { toast({ message: "Enter a monthly amount first" }); return; }
    setBusy(true);
    const savedMap = new Map((saved.data ?? []).filter((r) => r.category_id).map((r) => [r.category_id!, r]));
    const changed = [...limits.entries()].filter(([id, l]) => { const s = savedMap.get(id); return !s || s.base_pence !== l.amount || s.rollover !== l.rollover; });
    const o = saved.data?.find((r) => r.category_id === null);
    const overallChanged = !o || o.base_pence !== amount || o.covers !== covers;
    const r = await saveBudgets({
      from: hadBudget ? from : "this",
      overall: overallChanged ? { amount, covers } : null,
      limits: changed.map(([id, l]) => ({ category_id: id, amount: l.amount, rollover: l.rollover })),
      removed: [...removed].filter((id) => savedMap.has(id)),
    });
    setBusy(false);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
    toast({ message: hadBudget ? "Budget saved" : "Budget set" });
    router.push(sp.get("return") ?? "/budget");
  };

  const setAlert = async (key: "budget_alert_forecast" | "budget_alert_pct80" | "budget_alert_reached" | "budget_alert_weekly", v: boolean) => {
    const r = await updateProfile({ [key]: v });
    if (!r.ok) toast({ message: r.error }); else await qc.invalidateQueries({ queryKey: qk.profile });
  };

  const shown = more ? parents : parents.slice(0, 8);
  const editing = edit ? tree.byId.get(edit) : null;
  return (
    <div className="scroll" data-testid="budget-setup">
      <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 72px", alignItems: "center", padding: "50px 16px 4px" }}>
        <Link className="icon-btn" href={hadBudget ? "/budget" : "/"} aria-label="Close" style={{ justifySelf: "start" }}><UI.X size={18} strokeWidth={1.75} aria-hidden /></Link>
        <span style={{ textAlign: "center", fontSize: 17, fontWeight: 600 }}>Budgets</span>
        <button data-testid="budget-save" disabled={busy || !amount} onClick={save} style={{ justifySelf: "end", height: 34, padding: "0 16px", borderRadius: 17, background: "var(--ink)", color: "var(--on-ink)", fontSize: 15, fontWeight: 600, opacity: !amount ? 0.4 : 1 }}>Save</button>
      </div>

      <div style={{ padding: "0 16px" }}>
        <div className="eyebrow" style={{ margin: "18px 4px 8px" }}>Monthly budget</div>
        <div className="bg-card" style={{ padding: "0 16px" }}>
          <label className="row-between" style={{ minHeight: 76 }}>
            <span style={{ color: "var(--ink-2)", fontSize: 17 }}>Every month</span>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 600, color: "var(--ink-2)" }}>£</span>
              <MoneyInput testId="budget-amount" label="Monthly budget" value={amountText} onChange={setAmountText} />
            </span>
          </label>
          <button className="row-between" style={{ minHeight: 56, width: "100%", borderTop: "1px solid var(--rule)", textAlign: "left" }} onClick={() => setCoversOpen(true)} data-testid="budget-covers">
            <span style={{ fontSize: 17 }}>Covers</span><span className="sub" style={{ display: "flex", alignItems: "center", gap: 4, textAlign: "right" }}>{COVERS_LABEL[covers].replace("including", "incl.").replace(" and ", " & ")}<UI.ChevronRight size={16} aria-hidden /></span>
          </button>
          {hadBudget && (
            <button className="row-between" style={{ minHeight: 56, width: "100%", borderTop: "1px solid var(--rule)", textAlign: "left" }} onClick={() => setOverrideOpen(true)} data-testid="budget-override">
              <span style={{ fontSize: 17 }}>Adjust this month only</span><span className="sub" style={{ display: "flex", alignItems: "center", gap: 4 }}>{overallOverride !== null ? whole(overallOverride) : "Off"}<UI.ChevronRight size={16} aria-hidden /></span>
            </button>
          )}
          {hadBudget && (
            <div className="row-between" style={{ minHeight: 56, borderTop: "1px solid var(--rule)" }}>
              <span style={{ fontSize: 17, whiteSpace: "nowrap" }}>Applies from</span>
              <span className="seg" style={{ width: 176, height: 32, flex: "none", fontSize: 13 }} role="tablist">
                <button role="tab" aria-selected={from === "this"} className={from === "this" ? "on" : ""} style={{ fontSize: 13 }} onClick={() => setFrom("this")}>This month</button>
                <button role="tab" aria-selected={from === "next"} className={from === "next" ? "on" : ""} style={{ fontSize: 13 }} onClick={() => setFrom("next")}>Next month</button>
              </span>
            </div>
          )}
        </div>
        {avg !== null && (
          <p className="sub" style={{ margin: "12px 4px 0", lineHeight: 1.45 }} data-testid="budget-hint">
            You’ve spent {whole(avg)} a month on average over the last {done.length} months.{bills > 0 ? ` Your bills come to ${whole(bills)}, which leaves ${whole(Math.max(0, avg - bills))} for everything else.` : ""}
          </p>
        )}

        <div className="eyebrow" style={{ margin: "22px 4px 8px" }}>Category limits <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· optional, only where you need them</span></div>
        <div className="bg-card" style={{ padding: "0 16px" }} data-testid="limits-setup">
          {shown.map((c, i) => {
            const l = limits.get(c.id), u = usuals.get(c.id) ?? null;
            return (
              <button key={c.id} onClick={() => setEdit(c.id)} data-testid="setup-limit" data-limit={c.name}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 0", borderTop: i ? "1px solid var(--rule)" : undefined }}>
                <span className="tile" style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", flex: "none" }}><CategoryIcon name={c.icon} size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 17 }}>{c.name}</span>
                  <span className="sub" style={{ display: "block", fontSize: 13, marginTop: 1 }}>{u ? `Usual ${whole(u)} a month${c.is_fixed ? " · fixed bills" : ""}` : "Usual –"}</span>
                </span>
                {l ? <span className="num" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 17 }}>{whole(l.amount)}<UI.ChevronRight size={16} aria-hidden style={{ color: "var(--ink-3)" }} /></span>
                  : <span className="chip plain" style={{ height: 32, fontSize: 14, flex: "none" }}>Add limit</span>}
              </button>
            );
          })}
          {parents.length > 8 && <button className="row-between" style={{ minHeight: 48, width: "100%", borderTop: "1px solid var(--rule)", justifyContent: "flex-start", gap: 8 }} onClick={() => setMore((v) => !v)}><UI.ChevronDown size={16} aria-hidden />{more ? "Show fewer" : `${parents.length - 8} more categories`}</button>}
        </div>

        <div className="bg-card" style={{ marginTop: 14, padding: "0 16px" }}>
          <div className="row-between" style={{ minHeight: 56 }}><span style={{ fontSize: 17 }}>Limits set</span><span className="num" style={{ fontSize: 17 }} data-testid="limits-total">{whole(limitsTotal)}</span></div>
          <div className="row-between" style={{ minHeight: 56, borderTop: "1px solid var(--rule)" }}><span style={{ fontSize: 17 }}>Left for everything else</span><span className="num" style={{ fontSize: 17 }} data-testid="left-else">{left === null ? "–" : whole(Math.max(0, left))}</span></div>
        </div>
        {left !== null && left < 0 && <p className="sub" data-testid="limits-warning" style={{ margin: "10px 4px 0", color: "var(--caution)" }}>Your limits add up to {formatGBP(-left)} more than your monthly budget. You can still save; Everything else will show £0.</p>}

        <div className="eyebrow" style={{ margin: "22px 4px 8px" }}>Alerts</div>
        <div className="bg-card" style={{ padding: "0 16px" }}>
          <AlertRow label="Forecast to go over" sub="Warns early, from day 7, when a limit is likely to be missed" on={profile?.budget_alert_forecast ?? true} set={(v) => setAlert("budget_alert_forecast", v)} first />
          <AlertRow label="80% used" on={profile?.budget_alert_pct80 ?? true} set={(v) => setAlert("budget_alert_pct80", v)} />
          <AlertRow label="Limit reached" on={profile?.budget_alert_reached ?? true} set={(v) => setAlert("budget_alert_reached", v)} />
          <AlertRow label="Weekly check" sub="A Monday summary of how the month is going" on={profile?.budget_alert_weekly ?? false} set={(v) => setAlert("budget_alert_weekly", v)} />
        </div>
      </div>

      {editing && (
        <LimitSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} name={editing.name} categoryId={editing.id} usual={usuals.get(editing.id) ?? null}
          draft={limits.get(editing.id) ?? null} existing={limits.has(editing.id)}
          onSave={(d) => { setLimits(new Map(limits).set(editing.id, d)); setRemoved((r) => { const n = new Set(r); n.delete(editing.id); return n; }); }}
          onRemove={() => { const n = new Map(limits); n.delete(editing.id); setLimits(n); setRemoved((r) => new Set(r).add(editing.id)); }} />
      )}
      <Sheet open={coversOpen} onOpenChange={setCoversOpen} title="What the budget covers">
        <div className="vaul-body" data-testid="covers-sheet">
          <div className="sheet-head"><span /><span className="t">Covers</span><button className="txt" onClick={() => setCoversOpen(false)} style={{ color: "var(--ink)", fontWeight: 600 }}>Done</button></div>
          <div className="list" style={{ background: "var(--surface-2)", borderRadius: 12, padding: "0 16px" }}>
            {(Object.keys(COVERS_LABEL) as Covers[]).map((c, i) => (
              <button key={c} className="row-between" data-testid={`covers-${c}`} style={{ minHeight: 52, width: "100%", textAlign: "left", borderTop: i ? "1px solid var(--rule)" : undefined }} onClick={() => { setCovers(c); setCoversOpen(false); }}>
                <span>{COVERS_LABEL[c]}</span>{covers === c && <UI.Check size={18} aria-hidden />}
              </button>
            ))}
          </div>
          <p className="sub" style={{ margin: "12px 4px 0", lineHeight: 1.45 }}>Leaving bills out removes everything recurring from both the budget and the spend, and the plan becomes a straight line.</p>
        </div>
      </Sheet>
      <OverrideSheet open={overrideOpen} onOpenChange={setOverrideOpen} month={month} current={overallOverride} onDone={async () => { await qc.invalidateQueries(); }} />
    </div>
  );
}

function AlertRow({ label, sub, on, set, first }: { label: string; sub?: string; on: boolean; set: (v: boolean) => void; first?: boolean }) {
  return (
    <div className="row-between" style={{ minHeight: 56, padding: "8px 0", borderTop: first ? undefined : "1px solid var(--rule)" }}>
      <div><div style={{ fontSize: 17 }}>{label}</div>{sub && <div className="sub" style={{ fontSize: 13, maxWidth: 240 }}>{sub}</div>}</div>
      <Switch checked={on} onChange={set} label={label} />
    </div>
  );
}

function OverrideSheet({ open, onOpenChange, month, current, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; month: string; current: number | null; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(current !== null ? String(current / 100) : ""); }, [open, current]);
  const p = toPence(text);
  const go = async (amount: number | null) => {
    const r = await setBudgetOverride(null, month, amount);
    if (!r.ok) { toast({ message: r.error }); return; }
    await onDone(); onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Adjust this month only">
      <div className="vaul-body" data-testid="override-sheet">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">{formatMonthYear(month)} only</span><button className="txt" data-testid="override-save" style={{ color: "var(--ink)", fontWeight: 600, opacity: p ? 1 : 0.4 }} disabled={!p} onClick={() => go(p)}>Save</button></div>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}><span style={{ fontSize: 24, fontWeight: 600, color: "var(--ink-2)" }}>£</span>
            <MoneyInput testId="override-amount" label="This month's budget" value={text} onChange={setText} size={48} align="center" />
          </label>
          <div className="sub">for {formatMonthYear(month)} only · the usual amount comes back after</div>
        </div>
        {current !== null && <button className="link" style={{ display: "block", margin: "18px auto 8px", color: "var(--danger)" }} onClick={() => go(null)}>Turn off</button>}
      </div>
    </Sheet>
  );
}
