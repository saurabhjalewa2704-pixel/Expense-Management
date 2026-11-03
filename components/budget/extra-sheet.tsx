"use client";
// "Something you're planning" (§6.14.8, mock-up F3): a one-month extra, with the forecast before and after.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { addPlannedExtra } from "@/app/actions/forecast";
import { MoneyInput } from "@/components/budget/money-input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatMonth, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP, toPence } from "@/lib/money";
import { useCategoryTree } from "@/lib/queries/hooks";
import type { MonthForecast } from "@/lib/forecast-data";

export function ExtraSheet({ open, onOpenChange, month, data }: { open: boolean; onOpenChange: (o: boolean) => void; month: ISODate; data: MonthForecast }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { tree } = useCategoryTree();
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState<"any" | "date">("any");
  const [on, setOn] = useState<string>("");
  const [cat, setCat] = useState<string>("");
  useEffect(() => { if (open) { setAmount(""); setLabel(""); setWhen("any"); setOn(""); setCat(""); } }, [open]);
  const pence = toPence(amount);
  const valid = !!pence && pence > 0 && label.trim().length > 0 && (when === "any" || !!on);
  const name = formatMonth(month);
  const before = data.forecast.point;
  const save = async () => {
    const r = await addPlannedExtra({ month: monthStart(month), label: label.trim(), amount_pence: pence, on_date: when === "date" ? on : null, category_id: cat || null });
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
    toast({ message: "Added to your forecast" });
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Something you’re planning" nested>
      <div className="vaul-body" data-testid="extra-sheet" style={{ maxHeight: "calc(var(--sheet-max) - 36px)", overflowY: "auto" }}>
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">Something you’re planning</span>
          <button className="txt" data-testid="extra-save" disabled={!valid} style={{ color: "var(--ink)", fontWeight: 600, opacity: valid ? 1 : 0.4 }} onClick={save}>Add</button>
        </div>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}><span style={{ fontSize: 26, fontWeight: 600, color: "var(--ink-2)" }}>£</span>
            <MoneyInput testId="extra-amount" label="Amount" value={amount} onChange={setAmount} size={52} align="center" /></label>
          <div className="sub">Only counts in {name}</div>
        </div>
        <div className="list" style={{ background: "var(--surface-2)", borderRadius: 12, marginTop: 16, padding: "0 16px" }}>
          <label className="row-between" style={{ minHeight: 52 }}><span style={{ fontSize: 17 }}>What</span>
            <input data-testid="extra-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Christmas presents" maxLength={60} aria-label="What" style={{ background: "transparent", border: 0, color: "var(--ink)", font: "inherit", fontSize: 17, textAlign: "right", outline: "none", flex: 1, minWidth: 0 }} /></label>
          <div className="row-between" style={{ minHeight: 52, borderTop: "1px solid var(--rule)" }}><span style={{ fontSize: 17 }}>When</span>
            <span className="seg" style={{ width: 190, height: 32 }} role="tablist">
              <button role="tab" aria-selected={when === "any"} className={when === "any" ? "on" : ""} style={{ fontSize: 13 }} onClick={() => setWhen("any")}>Any time</button>
              <button role="tab" aria-selected={when === "date"} className={when === "date" ? "on" : ""} style={{ fontSize: 13 }} onClick={() => setWhen("date")}>On a date</button>
            </span></div>
          {when === "date" && (
            <label className="row-between" style={{ minHeight: 52, borderTop: "1px solid var(--rule)" }}><span style={{ fontSize: 17 }}>Date</span>
              <input type="date" data-testid="extra-date" value={on} min={monthStart(month)} max={monthEnd(month)} onChange={(e) => setOn(e.target.value)} aria-label="Date" style={{ background: "transparent", border: 0, color: "var(--ink)", font: "inherit", fontSize: 17 }} /></label>
          )}
          <label className="row-between" style={{ minHeight: 52, borderTop: "1px solid var(--rule)" }}><span style={{ fontSize: 17 }}>Category</span>
            <select data-testid="extra-category" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" style={{ background: "transparent", color: "var(--ink-2)", border: 0, font: "inherit", fontSize: 17, textAlign: "right" }}>
              <option value="">None · optional</option>
              {tree.parents("expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        </div>
        {before !== null && (
          <div className="row-between" style={{ background: "var(--surface-2)", borderRadius: 12, padding: "14px 16px", marginTop: 12 }} data-testid="extra-preview">
            <span className="sub">{name} forecast</span>
            <span className="num" style={{ fontSize: 17 }}>{pence ? <><s style={{ color: "var(--ink-3)", fontSize: 14, marginRight: 8 }}>{formatGBP(before)}</s><b style={{ fontWeight: 600 }} data-testid="extra-after">{formatGBP(before + pence)}</b></> : <b style={{ fontWeight: 600 }}>{formatGBP(before)}</b>}</span>
          </div>
        )}
        <p className="sub" style={{ display: "flex", gap: 10, margin: "14px 4px 0", lineHeight: 1.45 }}><UI.FileText size={16} strokeWidth={1.75} aria-hidden style={{ flex: "none", marginTop: 2 }} />Sterling won’t take this off automatically. When a spend looks like it’s part of it, you’ll be asked. It disappears when {name} ends.</p>
      </div>
    </Sheet>
  );
}
