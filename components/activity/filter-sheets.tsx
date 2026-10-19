"use client";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { addDays, formatMonthYear, monthEnd, monthStart, addMonths, yearStart, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { toPence } from "@/lib/money";
import { useAccounts, useCategoryTree } from "@/lib/queries/hooks";

export type PeriodKey = "this-month" | "last-month" | "90-days" | "this-year" | "all" | "custom";
export interface Period { key: PeriodKey; from?: ISODate; to?: ISODate }

export function periodRange(key: PeriodKey, today: ISODate, custom?: { from?: ISODate; to?: ISODate }): { from?: ISODate; to?: ISODate } {
  switch (key) {
    case "this-month": return { from: monthStart(today), to: monthEnd(today) };
    case "last-month": { const m = addMonths(monthStart(today), -1); return { from: m, to: monthEnd(m) }; }
    case "90-days": return { from: addDays(today, -89), to: today };
    case "this-year": return { from: yearStart(today), to: today };
    case "custom": return { from: custom?.from, to: custom?.to };
    default: return {};
  }
}

export function periodLabel(p: Period, today: ISODate): string {
  switch (p.key) {
    case "this-month": return formatMonthYear(today).split(" ")[0]!;
    case "last-month": return formatMonthYear(addMonths(monthStart(today), -1)).split(" ")[0]!;
    case "90-days": return "Last 90 days";
    case "this-year": return today.slice(0, 4);
    case "all": return "All time";
    default: return "Custom";
  }
}

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "This month" }, { key: "last-month", label: "Last month" }, { key: "90-days", label: "Last 90 days" },
  { key: "this-year", label: "This year" }, { key: "all", label: "All time" },
];

export function PeriodSheet({ open, onOpenChange, value, today, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: Period; today: ISODate; onChange: (p: Period) => void }) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState<string>(""); const [to, setTo] = useState<string>("");
  useEffect(() => { if (open) { setCustom(value.key === "custom"); setFrom(value.from ?? ""); setTo(value.to ?? ""); } }, [open, value]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Choose a period">
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">Period</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {OPTIONS.map((o) => (
            <button key={o.key} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onChange({ key: o.key, ...periodRange(o.key, today) }); onOpenChange(false); }}>
              <div className="row-main"><div className="row-t">{o.label}</div></div>
              <span className={`radio ${value.key === o.key ? "on" : ""}`}>{value.key === o.key && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
          <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setCustom(true)}>
            <div className="row-main"><div className="row-t">Custom range</div></div>
            <span className={`radio ${value.key === "custom" ? "on" : ""}`}>{value.key === "custom" && <UI.Check size={14} strokeWidth={2.5} />}</span>
          </button>
        </div>
        {custom && (
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field"><span className="muted" style={{ width: 44 }}>From</span><input type="date" aria-label="From date" style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span className="muted" style={{ width: 44 }}>To</span><input type="date" aria-label="To date" style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="btn" style={{ height: 48 }} disabled={!from && !to} onClick={() => { onChange({ key: "custom", from: from || undefined, to: to || undefined }); onOpenChange(false); }}>Apply range</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function AccountsFilterSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: string[]; onChange: (ids: string[]) => void }) {
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived_at);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter by account">
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => onChange([])}>Clear</button><span className="t">Accounts</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {accounts.map((a) => (
            <button key={a.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => toggle(a.id)} aria-pressed={value.includes(a.id)}>
              <div className="row-main"><div className="row-t">{a.name}</div></div>
              <span className={`radio ${value.includes(a.id) ? "on" : ""}`}>{value.includes(a.id) && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** Parent categories select all of their sub-categories (ACT-03). */
export function CategoriesFilterSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: string[]; onChange: (ids: string[]) => void }) {
  const { tree } = useCategoryTree();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const set = new Set(value);
  const parents = tree.parents(kind);
  const toggleParent = (id: string) => {
    const group = [id, ...tree.children(id).map((c) => c.id)];
    const all = group.every((g) => set.has(g));
    onChange(all ? value.filter((v) => !group.includes(v)) : [...new Set([...value, ...group])]);
  };
  const toggleOne = (id: string) => onChange(set.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter by category" maxHeight="92dvh">
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => onChange([])}>Clear</button><span className="t">Category</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="seg" role="tablist" aria-label="Category type" style={{ marginBottom: 14 }}>
          {(["expense", "income"] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "expense" ? "Expense" : "Income"}</button>)}
        </div>
        <div className="subs" style={{ marginTop: 0 }}>
          {parents.map((p) => {
            const kids = tree.children(p.id);
            const all = [p.id, ...kids.map((k) => k.id)].every((g) => set.has(g));
            return (
              <div key={p.id}>
                <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => toggleParent(p.id)} aria-pressed={all}>
                  <div className="row-main"><div className="row-t" style={{ fontWeight: 500 }}>{p.name}</div>{kids.length > 0 && <div className="row-s">{kids.length} sub-categories</div>}</div>
                  <span className={`radio ${all ? "on" : ""}`}>{all && <UI.Check size={14} strokeWidth={2.5} />}</span>
                </button>
                {kids.map((c) => (
                  <button key={c.id} className="row" style={{ width: "100%", textAlign: "left", paddingLeft: 36, minHeight: 44 }} onClick={() => toggleOne(c.id)} aria-pressed={set.has(c.id)}>
                    <div className="row-main"><div className="row-t" style={{ fontWeight: 400, fontSize: 15 }}>{c.name}</div></div>
                    <span className={`radio ${set.has(c.id) ? "on" : ""}`}>{set.has(c.id) && <UI.Check size={14} strokeWidth={2.5} />}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

const TYPES = [{ id: "expense", label: "Expenses" }, { id: "income", label: "Income" }, { id: "transfer", label: "Transfers" }, { id: "adjustment", label: "Adjustments" }];
export function TypeFilterSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter by type">
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => onChange([])}>Clear</button><span className="t">Type</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {TYPES.map((t) => (
            <button key={t.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => toggle(t.id)} aria-pressed={value.includes(t.id)}>
              <div className="row-main"><div className="row-t">{t.label}</div></div>
              <span className={`radio ${value.includes(t.id) ? "on" : ""}`}>{value.includes(t.id) && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function AmountFilterSheet({ open, onOpenChange, min, max, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; min?: number; max?: number; onChange: (v: { min?: number; max?: number }) => void }) {
  const [lo, setLo] = useState(""); const [hi, setHi] = useState("");
  useEffect(() => { if (open) { setLo(min != null ? String(min / 100) : ""); setHi(max != null ? String(max / 100) : ""); } }, [open, min, max]);
  const apply = () => { onChange({ min: lo ? toPence(lo) ?? undefined : undefined, max: hi ? toPence(hi) ?? undefined : undefined }); onOpenChange(false); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter by amount">
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => { onChange({}); onOpenChange(false); }}>Clear</button><span className="t">Amount</span><button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={apply}>Apply</button></div>
        <div className="stack">
          <label className="field"><span className="muted" style={{ width: 70 }}>At least</span><span className="muted">£</span><input inputMode="decimal" aria-label="Minimum amount" style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={lo} onChange={(e) => setLo(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" /></label>
          <label className="field"><span className="muted" style={{ width: 70 }}>At most</span><span className="muted">£</span><input inputMode="decimal" aria-label="Maximum amount" style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={hi} onChange={(e) => setHi(e.target.value.replace(/[^\d.]/g, ""))} placeholder="No limit" /></label>
        </div>
      </div>
    </Sheet>
  );
}
