"use client";
// Step 3 · Balances (MC05, MC06, §7): compare each account with the bank; sort out a difference in one database transaction.
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { updateProfile } from "@/app/actions/profile";
import { CategoryPicker } from "@/components/capture/category-picker";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ck, closeOnline } from "@/lib/close/data";
import { balancesShown, bankFigure, differenceOptions, differenceTitle, monthFromParam } from "@/lib/close/logic";
import type { BalanceItem, Resolution } from "@/lib/close/types";
import { addDays, monthEnd, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP, toPence } from "@/lib/money";
import { useCategoryTree } from "@/lib/queries/hooks";
import { CloseGate, CloseShell, StepHead, useCloseFlow } from "./common";

const TYPE_LABEL: Record<BalanceItem["type"], string> = { current: "Current account", savings: "Savings", credit_card: "Credit card", cash: "Wallet", other: "Account" };
const iconFor = (t: BalanceItem["type"]) => (t === "credit_card" ? <UI.CreditCard size={20} aria-hidden /> : t === "cash" ? <UI.Wallet size={20} aria-hidden /> : t === "savings" ? <UI.PiggyBank size={20} aria-hidden /> : <UI.Landmark size={20} aria-hidden />);
const owed = (a: BalanceItem, pence: number) => (a.type === "credit_card" ? (pence < 0 ? `${formatGBP(-pence)} owed` : pence === 0 ? "£0.00 owed" : `${formatGBP(pence)} in credit`) : formatGBP(pence));

export function StepBalances({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}

function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const qc = useQueryClient();
  const toast = useToast();
  const [savings, setSavings] = useState(f.checkSavings);
  useEffect(() => setSavings(f.checkSavings), [f.checkSavings]);
  const [online, setOnline] = useState(true);
  useEffect(() => { const u = () => setOnline(navigator.onLine); u(); window.addEventListener("online", u); window.addEventListener("offline", u); return () => { window.removeEventListener("online", u); window.removeEventListener("offline", u); }; }, []);
  const [sheet, setSheet] = useState<{ account: BalanceItem; bank: number } | null>(null);
  const all = f.checks.data!.balances;
  const accounts = balancesShown(all, savings);
  const done = accounts.filter((a) => a.answer).length;
  const matches = accounts.filter((a) => a.answer === "match").length;
  const toggle = async (v: boolean) => { setSavings(v); await updateProfile({ close_check_savings: v }); await qc.invalidateQueries({ queryKey: ["profile"] }); };
  const reconcile = async (a: BalanceItem, bank: number, resolution: Resolution, category?: string, date?: ISODate) => {
    const r = await closeOnline("close_reconcile_account", { p_month: month, p_account: a.account_id, p_bank_balance: bank, p_resolution: resolution, p_category: category ?? null, p_date: date ?? null, p_today: f.today });
    if (!r.ok) { toast({ message: r.error.includes("does not match") ? "Sterling's balance changed. Enter the figure again." : r.error }); return false; }
    await qc.invalidateQueries();
    return true;
  };
  const sub = (n: number) => `${accounts.length - done} to ${n ? "sort out" : "check"}`;
  void sub;
  return (
    <CloseShell month={month} index={3} back={() => f.go("overview")}
      hint={accounts.length ? `${matches} of ${accounts.length} match${done - matches ? ` · ${done - matches} resolved` : ""}${accounts.length - done ? ` · ${accounts.length - done} to check` : ""}` : undefined}
      footer={<button className="btn" data-testid="close-continue" onClick={() => void f.finishStep("balances")}>Continue</button>}>
      <StepHead step="Step 3 · Balances" title={accounts.length ? "Do your balances match?" : "No accounts to check"}
        lead={accounts.length ? "Open your banking app and compare today’s balance. Sterling’s figures include everything logged up to now, today included." : "Add an account in Settings to compare it here."} />
      {!online && accounts.length > 0 && <p className="mc-note" data-testid="balances-offline">Connect to check a balance. Your other answers are saved on this device.</p>}
      {accounts.map((a) => (
        <AccountCard key={a.account_id} a={a} online={online} onMatch={() => reconcile(a, a.sterling_pence, "match")} onDifference={(bank) => setSheet({ account: a, bank })} />
      ))}
      <div className="mc-item" style={{ marginTop: 12 }}>
        <div className="hd"><div className="tile"><UI.PiggyBank size={20} aria-hidden /></div><div className="ti"><b>Check savings too</b><span>{all.filter((x) => !x.counts_as_cash).map((x) => x.name).join(", ") || "Accounts that aren’t in available cash"} {all.some((x) => !x.counts_as_cash) ? "isn’t in available cash" : ""}</span></div>
          <Switch checked={savings} onChange={toggle} label="Check savings too" /></div>
      </div>
      <p className="mc-note">Use the balance that includes pending payments if your bank shows two figures.</p>
      {sheet && (
        <DifferenceSheet open onOpenChange={(o) => !o && setSheet(null)} account={sheet.account} bank={sheet.bank} month={month} today={f.today}
          onSave={async (res, cat, date) => { const ok = await reconcile(sheet.account, sheet.bank, res, cat, date); if (ok) setSheet(null); return ok; }} />
      )}
    </CloseShell>
  );
}

function AccountCard({ a, online, onMatch, onDifference }: { a: BalanceItem; online: boolean; onMatch: () => Promise<boolean>; onDifference: (bank: number) => void }) {
  const [text, setText] = useState("");
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCard = a.type === "credit_card";
  const typed = text.trim() === "" ? null : toPence(text.replace(/^[-−]/, ""));
  const neg = /^[-−]/.test(text.trim());
  const bank = typed === null ? null : bankFigure(a.type, typed, credit || neg);
  const diff = bank === null ? null : bank - a.sterling_pence;
  const done = a.answer;
  useEffect(() => { if (neg && isCard) setCredit(true); }, [neg, isCard]);
  const sterling = owed(a, a.sterling_pence);
  return (
    <div className="mc-item" data-testid="balance-item" data-account={a.name} data-answer={done ?? ""}>
      <div className="hd">
        <div className="tile">{iconFor(a.type)}</div>
        <div className="ti"><b>{a.name}</b><span>{TYPE_LABEL[a.type]}{done === "match" ? " · matches your bank" : done ? " · resolved" : isCard ? " · what does your card app show as owed?" : ""}</span></div>
        {done ? <><div className="am">{owed(a, a.payload?.bank ?? a.sterling_pence)}</div><span className="mc-pill pos" style={{ marginLeft: 8 }} aria-label="Checked"><UI.Check size={14} strokeWidth={2.5} aria-hidden /></span></> : <div className="am dim">{sterling}</div>}
      </div>
      {!done && (
        <>
          <div className="mc-diff">
            <div><div className="k">Sterling says</div><div className="v" data-testid="sterling-says">{sterling}</div></div>
            <div style={diff === null ? { boxShadow: "inset 0 0 0 1px var(--rule-strong)" } : undefined}>
              <div className="k">{diff === null ? "Your bank" : "You counted"}</div>
              <div className="v" style={{ display: "flex", gap: 2 }}><span className="faint">£</span>
                <input inputMode="decimal" aria-label={`${a.name} balance in your bank`} data-testid="balance-input" placeholder="—" value={text} onChange={(e) => setText(e.target.value)}
                  style={{ background: "none", border: 0, outline: "none", width: "100%", minWidth: 0, fontSize: "inherit", fontWeight: 600, color: "inherit", fontVariantNumeric: "tabular-nums" }} /></div>
            </div>
          </div>
          {isCard && typed !== null && <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} /> It’s in credit (the bank owes me)</label>}
          {diff !== null && diff !== 0 && (
            <div className="mc-gap" data-testid="balance-gap"><span>{formatGBP(Math.abs(diff))} {diff < 0 ? "less" : "more"} than Sterling expects</span><b>{formatGBP(diff, { signed: true })}</b></div>
          )}
          <div className="mc-acts">
            {diff === null && (<>
              <button className="mc-act on" data-testid="balance-matches" disabled={busy || !online} onClick={async () => { setBusy(true); await onMatch(); setBusy(false); }}><UI.Check size={16} aria-hidden />Matches</button>
              <button className="mc-act" data-testid="balance-enter" onClick={(e) => (e.currentTarget.closest("[data-testid=balance-item]")?.querySelector("input") as HTMLInputElement | null)?.focus()}>Enter amount</button>
            </>)}
            {diff === 0 && <button className="mc-act on" data-testid="balance-confirm-match" disabled={busy || !online} onClick={async () => { setBusy(true); await onMatch(); setBusy(false); }}><UI.Check size={16} aria-hidden />Matches your bank</button>}
            {diff !== null && diff !== 0 && (<>
              <button className="mc-act on" data-testid="balance-sort" disabled={!online} onClick={() => onDifference(bank!)}>Sort out the difference <UI.ChevronRight size={16} aria-hidden /></button>
              <button className="mc-act ghost" onClick={() => setText("")}>Re-enter</button>
            </>)}
          </div>
        </>
      )}
      {done && done !== "match" && a.payload && <p className="mc-note" style={{ marginTop: 10 }}>Sterling said {owed(a, a.payload.sterling)}; your bank said {owed(a, a.payload.bank)}.</p>}
    </div>
  );
}

/** MC06: what happened to the difference. */
function DifferenceSheet({ open, onOpenChange, account, bank, month, today, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; account: BalanceItem; bank: number; month: ISODate; today: ISODate;
  onSave: (res: Resolution, category?: string, date?: ISODate) => Promise<boolean>;
}) {
  const diff = bank - account.sterling_pence;
  const { options, preselected } = differenceOptions(diff);
  const [choice, setChoice] = useState<Resolution>(preselected);
  const [dateChoice, setDateChoice] = useState<"month_end" | "today">("month_end");
  const [category, setCategory] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { tree } = useCategoryTree();
  const [busy, setBusy] = useState(false);
  const amt = formatGBP(Math.abs(diff));
  const spends = choice === "untracked_spend" || choice === "untracked_income";
  const defaultCat = choice === "untracked_income" ? "Untracked income" : account.type === "cash" ? "Other › Untracked cash" : "Other › Untracked";
  const catLabel = category ? (() => { const c = tree.byId.get(category); const p = c?.parent_id ? tree.byId.get(c.parent_id) : null; return p ? `${p.name} › ${c?.name}` : c?.name ?? defaultCat; })() : defaultCat;
  const lastDay = monthEnd(month);
  const dateLabel = new Date(`${lastDay}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const save = async () => { setBusy(true); const ok = await onSave(choice, spends ? category ?? undefined : undefined, dateChoice === "today" ? today : lastDay); setBusy(false); void ok; };
  const label = (r: Resolution) => r === "untracked_spend" ? ["I spent it and didn’t log it", `Logs ${amt} of spending in ${new Date(`${month}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })}, so your totals are right`]
    : r === "untracked_income" ? ["Money came in that I didn’t log", `Logs ${amt} of income, so your totals are right`] : ["Just correct the balance", "An adjustment. It isn’t spending and won’t show in analytics"];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Sort out the difference">
      <div className="vaul-body" data-testid="difference-sheet">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t" data-testid="difference-title">{differenceTitle(account.name, account.type, diff)}</span>
          <button className="txt" data-testid="difference-save" disabled={busy} style={{ color: "var(--ink)", fontWeight: 600 }} onClick={save}>Save</button></div>
        <p className="sub" style={{ margin: "0 4px 6px" }}>What happened to the {amt}?</p>
        <div className="card" style={{ padding: "0 16px", background: "var(--surface-2)" }}>
          {options.map((r) => (
            <button key={r} className="mc-opt" data-testid={`opt-${r}`} onClick={() => setChoice(r)}>
              <span style={{ flex: 1 }}><b>{label(r)[0]}</b><span>{label(r)[1]}</span></span>
              <span className={`radio ${choice === r ? "on" : ""}`} aria-hidden>{choice === r && <UI.Check size={14} strokeWidth={3} />}</span>
            </button>
          ))}
          <Link href={`/activity?account=${account.account_id}&from=${addDays(today, -14)}`} className="mc-opt" data-testid="opt-look" onClick={() => onOpenChange(false)}>
            <span style={{ flex: 1 }}><b>Let me look first</b><span>Opens {account.name} in Activity for the last 14 days</span></span>
            <UI.ChevronRight size={16} className="chev" aria-hidden />
          </Link>
        </div>
        {spends && (
          <div className="card" style={{ marginTop: 12, padding: "0 16px", background: "var(--surface-2)" }}>
            <button className="row-between" style={{ width: "100%", height: 52 }} data-testid="difference-category" onClick={() => setPicking(true)}><span>Category</span><span className="muted">{catLabel} <UI.ChevronRight size={14} aria-hidden style={{ verticalAlign: "-2px" }} /></span></button>
            <div className="row-between" style={{ height: 52, borderTop: "1px solid var(--rule)" }}><span>Date</span>
              <span className="seg" role="tablist" style={{ width: 170, height: 32 }}>
                <button role="tab" aria-selected={dateChoice === "month_end"} className={dateChoice === "month_end" ? "on" : ""} onClick={() => setDateChoice("month_end")}>{dateLabel}</button>
                <button role="tab" aria-selected={dateChoice === "today"} className={dateChoice === "today" ? "on" : ""} onClick={() => setDateChoice("today")}>Today</button>
              </span></div>
          </div>
        )}
        <p className="sub" style={{ margin: "12px 4px 0", lineHeight: 1.45 }} data-testid="difference-note">After saving, {account.name} shows <b style={{ color: "var(--ink)" }}>{owed(account, bank)}</b> and is marked as checked today. Anything you back-date before today won’t change it again.</p>
      </div>
      <CategoryPicker open={picking} onOpenChange={setPicking} kind={choice === "untracked_income" ? "income" : "expense"} selectedId={category} onSelect={(id) => { setCategory(id); setPicking(false); }} />
    </Sheet>
  );
}
export { ck };
