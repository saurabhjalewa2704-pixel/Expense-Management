"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { saveRecurring } from "@/app/actions/recurring";
import { AccountPicker, DateSheet } from "@/components/capture/pickers";
import { CategoryPicker } from "@/components/capture/category-picker";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addDays, dayOfMonth, formatMonthYear, formatShort, isISODate, weekdayIndex, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP, pressKey, toPence } from "@/lib/money";
import { firstOccurrence, ordinal, type RecurrenceRule } from "@/lib/recurrence";
import { ruleSentence } from "@/lib/recurrence-copy";
import { fetchActivityPage } from "@/lib/queries/fetchers";
import { useAccounts, useBankHolidays, useCategoryTree, usePayees, useRecurringItems, useToday } from "@/lib/queries/hooks";
import { RecurringInput } from "@/lib/schemas/recurring";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { RecurFreq } from "@/lib/types";

type Kind = "expense" | "income" | "transfer";
const KINDS: { id: Kind; label: string }[] = [{ id: "expense", label: "Expense" }, { id: "income", label: "Income" }, { id: "transfer", label: "Transfer" }];
const FREQ: { id: RecurFreq; label: string }[] = [{ id: "monthly", label: "Monthly" }, { id: "quarterly", label: "Every 3 months" }, { id: "yearly", label: "Yearly" }, { id: "weekly", label: "Weekly" }];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NO_ITEMS: never[] = [];

function Choice<T extends string>({ open, onOpenChange, title, options, value, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; options: { id: T; label: string; sub?: string }[]; value: T; onPick: (v: T) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">{title}</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="subs" style={{ marginTop: 0 }}>
          {options.map((o) => (
            <button key={o.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onPick(o.id); onOpenChange(false); }}>
              <div className="row-main"><div className="row-t">{o.label}</div>{o.sub && <div className="row-s">{o.sub}</div>}</div>
              <span className={`radio ${value === o.id ? "on" : ""}`}>{value === o.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function AmountSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onChange: (v: string) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Amount">
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">Amount</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <div className="amount num" style={{ marginTop: 4 }}><span className="cur">£</span><span className="whole" style={value === "" ? { color: "var(--ink-3)" } : undefined}>{value === "" ? "0" : value}</span></div>
        <div className="keypad num" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => <button key={k} className="key" aria-label={k === "." ? "Decimal point" : k} onClick={() => onChange(pressKey(value, k))}>{k}</button>)}
          <button className="key fn" aria-label="Delete" onClick={() => onChange(pressKey(value, "back"))}><UI.Delete size={24} strokeWidth={1.75} /></button>
        </div>
      </div>
    </Sheet>
  );
}

const Rowish = ({ label, value, onClick, testId, muted }: { label: string; value: string; onClick?: () => void; testId?: string; muted?: boolean }) => (
  <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={onClick} disabled={!onClick} data-testid={testId}>
    <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>{label}</div></div>
    <span style={{ color: muted ? "var(--ink-2)" : "var(--ink)", textAlign: "right", maxWidth: "62%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    {onClick && <UI.ChevronRight size={16} strokeWidth={2} className="faint" aria-hidden />}
  </button>
);

/** REC-03: New / Edit recurring payment, full screen. `id` set = edit (changes apply to future payments only). */
export function BillForm({ id }: { id?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const { tree } = useCategoryTree();
  const accounts = useAccounts().data ?? NO_ITEMS;
  const payees = usePayees().data ?? NO_ITEMS;
  const holidays = useBankHolidays().data;
  const items = useRecurringItems();
  const item = id ? (items.data ?? []).find((i) => i.id === id) : undefined;

  const [type, setType] = useState<Kind>("expense");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [payeeFocus, setPayeeFocus] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [varies, setVaries] = useState(false);
  const [freq, setFreq] = useState<RecurFreq>("monthly");
  const [dom, setDom] = useState<number>(dayOfMonth(today));
  const [lastDay, setLastDay] = useState(false);
  const [weekday, setWeekday] = useState<number>(weekdayIndex(today) + 1);
  const [moy, setMoy] = useState<number>(Number(today.slice(5, 7)));
  const [firstOn, setFirstOn] = useState<ISODate>(today);
  const [firstTouched, setFirstTouched] = useState(false);
  const [endsMode, setEndsMode] = useState<"never" | "date" | "count">("never");
  const [endsOn, setEndsOn] = useState<ISODate>(addDays(today, 365));
  const [maxN, setMaxN] = useState("12");
  const [wd, setWd] = useState<"on_day" | "next_working_day">("on_day");
  const [auto, setAuto] = useState(true);
  const [catchUp, setCatchUp] = useState<"log" | "next">("next");
  const [loggedAlready, setLoggedAlready] = useState(false);
  const [picker, setPicker] = useState<null | "amount" | "category" | "account" | "counter" | "freq" | "ends" | "wd" | "first">(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  // editing: fill the form from the saved rule, once
  useEffect(() => {
    if (!item || loaded) return;
    setType(item.type); setAmount(String(item.amount_pence / 100).replace(/(\.\d)$/, "$10")); setCategoryId(item.category_id); setAccountId(item.account_id); setCounterId(item.counter_account_id);
    setPayee(payees.find((p) => p.id === item.payee_id)?.name ?? ""); setVaries(item.amount_varies); setFreq(item.frequency);
    if (item.day_of_month) setDom(item.day_of_month);
    setLastDay(item.last_day); if (item.weekday) setWeekday(item.weekday); if (item.month_of_year) setMoy(item.month_of_year);
    setWd(item.working_day_rule); setAuto(item.auto_log); setFirstOn(item.starts_on); setFirstTouched(true);
    if (item.ends_on) { setEndsMode("date"); setEndsOn(item.ends_on); } else if (item.max_occurrences) { setEndsMode("count"); setMaxN(String(item.max_occurrences)); }
    setLoaded(true);
  }, [item, loaded, payees]);

  const defaultAccount = accounts.find((a) => a.is_default && !a.archived_at) ?? accounts.find((a) => !a.archived_at);
  const effAccount = accountId ?? defaultAccount?.id ?? null;
  const account = accounts.find((a) => a.id === effAccount);
  const counter = accounts.find((a) => a.id === counterId);
  const category = categoryId ? tree.byId.get(categoryId) : undefined;
  const pence = toPence(amount || "0") ?? 0;

  const rule = useMemo<RecurrenceRule>(() => ({
    frequency: freq, day_of_month: freq === "weekly" || lastDay ? null : dom, last_day: freq !== "weekly" && lastDay, weekday: freq === "weekly" ? weekday : null,
    month_of_year: freq === "yearly" ? moy : null, working_day_rule: wd, starts_on: firstOn, ends_on: endsMode === "date" ? endsOn : null,
    max_occurrences: endsMode === "count" ? Math.max(1, Number(maxN) || 1) : null,
  }), [freq, dom, lastDay, weekday, moy, wd, firstOn, endsMode, endsOn, maxN]);

  // First payment: the next date that matches, on or after today, until the owner picks one themselves
  const autoFirst = useMemo(() => firstOccurrence({ ...rule, starts_on: today }, today, holidays)?.scheduled_on ?? null, [rule, today, holidays]);
  useEffect(() => { if (!id && !firstTouched && autoFirst) setFirstOn(autoFirst); }, [id, firstTouched, autoFirst]);

  // Catch-up (monthly / every 3 months): the day has already gone this month. Offer to log this month's now, unless it was already logged by hand.
  const thisMonthDate = useMemo<ISODate | null>(() => {
    if (id || (freq !== "monthly" && freq !== "quarterly")) return null;
    const len = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    const d = lastDay ? len : Math.min(dom, len);
    const iso = `${today.slice(0, 8)}${String(d).padStart(2, "0")}`;
    return isISODate(iso) && iso < today ? iso : null;
  }, [id, freq, lastDay, dom, today]);
  const matchedPayee = useMemo(() => payees.find((p) => p.name_norm === payee.trim().toLowerCase().replace(/\s+/g, " ")), [payees, payee]);
  useEffect(() => {
    setLoggedAlready(false);
    if (!thisMonthDate || !matchedPayee || type === "transfer") return;
    let live = true;
    fetchActivityPage(supabaseBrowser(), { payeeId: matchedPayee.id, from: thisMonthDate, to: today, types: ["expense", "income"] }, undefined, 5)
      .then((r) => { if (live) setLoggedAlready(r.length > 0); }).catch(() => undefined);
    return () => { live = false; };
  }, [thisMonthDate, matchedPayee, type, today]);
  const askCatchUp = !!thisMonthDate && !firstTouched && (type === "transfer" || !loggedAlready);
  useEffect(() => { if (!askCatchUp) setCatchUp("next"); }, [askCatchUp]);

  const to = type === "transfer" ? counter?.name ?? "" : payee.trim();
  const sentence = ruleSentence({ type, amount_pence: pence, amount_varies: varies, auto_log: auto, to, from: account?.name, rule, first: catchUp === "log" && thisMonthDate ? thisMonthDate : firstOn });
  const input = {
    type, amount_pence: pence, amount_varies: varies, account_id: effAccount ?? "", counter_account_id: type === "transfer" ? counterId : null,
    category_id: type === "transfer" ? null : categoryId, payee: type === "transfer" ? null : payee.trim() || null, frequency: freq,
    day_of_month: rule.day_of_month, last_day: rule.last_day, weekday: rule.weekday, month_of_year: rule.month_of_year, working_day_rule: wd,
    starts_on: id ? firstOn : catchUp === "log" && thisMonthDate ? thisMonthDate : firstOn, ends_on: rule.ends_on, max_occurrences: rule.max_occurrences, auto_log: auto, catch_up: catchUp,
  };
  const valid = RecurringInput.safeParse(input);
  const canSave = valid.success && pence > 0 && !busy && (!id || loaded);
  const dirty = !id && (amount !== "" || payee !== "" || categoryId !== null);

  const close = () => (id ? router.back() : router.replace("/bills"));
  const save = async () => {
    setBusy(true); setError(undefined);
    const r = await saveRecurring(id ?? null, input);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: r.data.logged ? `${to || "Payment"} logged, and added to Bills` : id ? "Saved. Changes apply from the next payment." : `${to || "Payment"} added to Bills` });
    router.replace(id ? `/bills/${id}` : "/bills");
  };

  const suggestions = useMemo(() => {
    const q = payee.trim().toLowerCase();
    return q && payeeFocus ? payees.filter((p) => p.name_norm.includes(q) && p.name_norm !== q).slice(0, 4) : [];
  }, [payee, payeeFocus, payees]);
  const applyPayee = (p: (typeof payees)[number]) => { setPayee(p.name); if (p.default_category_id && !categoryId && type !== "transfer") setCategoryId(p.default_category_id); setPayeeFocus(false); };

  const onDayLabel = freq === "weekly" ? `${WEEKDAYS[weekday - 1]}s` : freq === "yearly" ? `${lastDay ? "Last day" : ordinal(dom)} of ${MONTHS[moy - 1]}` : lastDay ? "Last day of each month" : `${ordinal(dom)} of each ${freq === "quarterly" ? "3rd month" : "month"}`;
  const endsLabel = endsMode === "never" ? "Never" : endsMode === "date" ? formatShort(endsOn) : `After ${maxN} payment${maxN === "1" ? "" : "s"}`;
  const nextLabel = item ? formatShort(item.next_due_on) : "";

  return (
    <div className="fullpage" data-testid="bill-form">
      <div className="fullpage-in">
        <div className="fp-bar">
          <button className="icon-btn" aria-label="Close" onClick={() => (dirty ? setConfirmDiscard(true) : close())}><UI.X size={18} strokeWidth={2} aria-hidden /></button>
          <h1 className="fp-title">{id ? "Edit recurring" : "New recurring"}</h1>
          <button className="btn" style={{ width: "auto", height: 40, padding: "0 20px", opacity: canSave ? 1 : 0.4 }} disabled={!canSave} onClick={save} data-testid="bill-save">Save</button>
        </div>

        <div className="seg" role="tablist" aria-label="Type" style={{ marginTop: 14 }}>
          {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={type === k.id} className={type === k.id ? "on" : ""} disabled={!!id} onClick={() => { setType(k.id); setCategoryId(null); if (k.id === "transfer") setVaries(false); }}>{k.label}</button>)}
        </div>

        <button className="amount num" style={{ width: "100%", background: "none" }} aria-label={`Amount ${formatGBP(pence)}. Tap to change`} onClick={() => setPicker("amount")} data-testid="bill-amount">
          <span className="cur">£</span><span className="whole" style={amount === "" ? { color: "var(--ink-3)" } : undefined}>{amount === "" ? "0.00" : amount}</span>
        </button>
        <div className="sub" style={{ textAlign: "center", marginTop: -4 }}>Tap to change amount</div>

        <div className="list" style={{ marginTop: 16 }}>
          {type === "transfer" ? (
            <Rowish label="To account" value={counter?.name ?? "Choose"} onClick={() => setPicker("counter")} testId="bill-to" />
          ) : (
            <div className="row" style={{ position: "relative" }}>
              <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>{type === "income" ? "From" : "Payee"}</div></div>
              <input aria-label="Payee" className="v" placeholder={type === "income" ? "Who pays you?" : "Who is it paid to?"} autoComplete="off" autoCapitalize="words" maxLength={80}
                style={{ background: "none", border: 0, outline: "none", textAlign: "right", minWidth: 0, width: "62%", color: "var(--ink)" }}
                value={payee} onChange={(e) => setPayee(e.target.value)} onFocus={() => setPayeeFocus(true)} onBlur={() => setTimeout(() => setPayeeFocus(false), 120)} />
            </div>
          )}
          {suggestions.length > 0 && suggestions.map((p) => (
            <button key={p.id} className="row" style={{ width: "100%", textAlign: "left", minHeight: 44 }} onMouseDown={(e) => e.preventDefault()} onClick={() => applyPayee(p)}>
              <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>{p.name}</div></div>
            </button>
          ))}
          {type !== "transfer" && <Rowish label="Category" value={category?.name ?? "Choose"} onClick={() => setPicker("category")} testId="bill-category" muted={!category} />}
          <Rowish label={type === "transfer" ? "From account" : "Account"} value={account?.name ?? "Choose"} onClick={() => setPicker("account")} testId="bill-account" />
          {type !== "transfer" && (
            <div className="row">
              <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Amount</div></div>
              <div className="seg" role="radiogroup" aria-label="Amount" style={{ width: 170, height: 34 }}>
                <button role="radio" aria-checked={!varies} className={!varies ? "on" : ""} onClick={() => setVaries(false)}>Fixed</button>
                <button role="radio" aria-checked={varies} className={varies ? "on" : ""} onClick={() => setVaries(true)}>Varies</button>
              </div>
            </div>
          )}
        </div>

        <div className="list" style={{ marginTop: 12 }}>
          <Rowish label="Repeats" value={FREQ.find((f) => f.id === freq)!.label} onClick={() => setPicker("freq")} testId="bill-repeats" />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>On day</div></div>
            <span data-testid="bill-onday" style={{ color: "var(--ink)" }}>{onDayLabel}</span>
            <div style={{ width: "100%" }}>
              {freq === "weekly" ? (
                <div className="chips" role="radiogroup" aria-label="Weekday" style={{ marginTop: 10 }}>
                  {WEEKDAYS.map((w, i) => <button key={w} role="radio" aria-checked={weekday === i + 1} className={`chip plain${weekday === i + 1 ? " sel" : ""}`} onClick={() => setWeekday(i + 1)}>{w.slice(0, 3)}</button>)}
                </div>
              ) : (
                <>
                  {freq === "yearly" && (
                    <select aria-label="Month" className="field" style={{ marginTop: 10, width: "100%" }} value={moy} onChange={(e) => setMoy(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                  )}
                  <div className="dayg" role="group" aria-label="Day of the month">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} aria-pressed={!lastDay && dom === d} onClick={() => { setDom(d); setLastDay(false); }}>{d}</button>)}
                    <button className="last" aria-pressed={lastDay} onClick={() => setLastDay(true)}>Last day</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {askCatchUp && thisMonthDate && (
          <div className="card" style={{ marginTop: 12 }} role="group" aria-label="Catch up" data-testid="bill-catchup">
            <div className="headline">{(to || "This payment")} was due on the {ordinal(Number(thisMonthDate.slice(8)))}.</div>
            <p className="sub" style={{ marginTop: 4 }}>Log {formatMonthYear(thisMonthDate).split(" ")[0]}’s now?</p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className={`btn${catchUp === "log" ? "" : " secondary"}`} style={{ height: 42, flex: 1, fontSize: 14 }} aria-pressed={catchUp === "log"} onClick={() => setCatchUp("log")}>Log it now</button>
              <button className={`btn${catchUp === "next" ? "" : " secondary"}`} style={{ height: 42, flex: 1, fontSize: 14 }} aria-pressed={catchUp === "next"} onClick={() => setCatchUp("next")}>Start next month</button>
            </div>
          </div>
        )}

        <div className="list" style={{ marginTop: 12 }}>
          {id ? <Rowish label="Next payment" value={nextLabel} muted /> : <Rowish label="First payment" value={catchUp === "log" && thisMonthDate ? formatShort(thisMonthDate) : firstOn === today ? `Today, ${formatShort(firstOn)}` : formatShort(firstOn)} onClick={() => setPicker("first")} testId="bill-first" />}
          <Rowish label="Ends" value={endsLabel} onClick={() => setPicker("ends")} testId="bill-ends" />
          <Rowish label="Weekends & bank holidays" value={wd === "on_day" ? "On the day" : "Next working day"} onClick={() => setPicker("wd")} testId="bill-wd" muted />
        </div>

        <div className="list" style={{ marginTop: 12 }}>
          <div className="row">
            <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Log automatically</div><div className="row-s">Off: remind me to confirm instead</div></div>
            <Switch label="Log automatically" checked={auto} onChange={setAuto} />
          </div>
        </div>

        <p className="rec-summary" data-testid="bill-summary"><UI.Repeat size={18} strokeWidth={1.75} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>{sentence}</span></p>
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", margin: "10px 4px" }}>{error}</p>}
        {!valid.success && (amount !== "" || payee !== "") && <p className="sub" style={{ margin: "6px 4px" }} data-testid="bill-hint">{valid.error.issues[0]?.message}</p>}
        <div style={{ height: 40 }} />
      </div>

      <AmountSheet open={picker === "amount"} onOpenChange={(o) => setPicker(o ? "amount" : null)} value={amount} onChange={setAmount} />
      <CategoryPicker open={picker === "category"} onOpenChange={(o) => setPicker(o ? "category" : null)} kind={type === "income" ? "income" : "expense"} selectedId={categoryId} onSelect={setCategoryId} />
      <AccountPicker open={picker === "account"} onOpenChange={(o) => setPicker(o ? "account" : null)} title={type === "transfer" ? "From account" : "Account"} selectedId={effAccount} excludeId={type === "transfer" ? counterId : undefined} onSelect={setAccountId} />
      <AccountPicker open={picker === "counter"} onOpenChange={(o) => setPicker(o ? "counter" : null)} title="To account" selectedId={counterId} excludeId={effAccount} onSelect={setCounterId} />
      <Choice open={picker === "freq"} onOpenChange={(o) => setPicker(o ? "freq" : null)} title="Repeats" value={freq} options={FREQ} onPick={(f) => { setFreq(f); setFirstTouched(false); }} />
      <Choice open={picker === "wd"} onOpenChange={(o) => setPicker(o ? "wd" : null)} title="Weekends & bank holidays" value={wd}
        options={[{ id: "on_day", label: "On the day", sub: "Logged on the date, even at a weekend" }, { id: "next_working_day", label: "Next working day", sub: "Moves on from weekends and England & Wales bank holidays" }]} onPick={setWd} />
      <DateSheet open={picker === "first"} onOpenChange={(o) => setPicker(o ? "first" : null)} value={firstOn} min={today} onChange={(d) => { setFirstOn(d < today ? today : d); setFirstTouched(true); }} />
      <Sheet open={picker === "ends"} onOpenChange={(o) => setPicker(o ? "ends" : null)} title="Ends">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">Ends</span><button className="txt" onClick={() => setPicker(null)}>Done</button></div>
          <div className="subs" style={{ marginTop: 0 }}>
            {([["never", "Never"], ["date", "On a date"], ["count", "After a number of payments"]] as const).map(([k, l]) => (
              <button key={k} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => setEndsMode(k)}>
                <div className="row-main"><div className="row-t">{l}</div></div><span className={`radio ${endsMode === k ? "on" : ""}`}>{endsMode === k && <UI.Check size={14} strokeWidth={2.5} />}</span>
              </button>
            ))}
          </div>
          {endsMode === "date" && <label className="field" style={{ marginTop: 12 }}><span className="muted" style={{ width: 60 }}>Ends on</span><input type="date" aria-label="End date" min={firstOn} style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>}
          {endsMode === "count" && <label className="field" style={{ marginTop: 12 }}><span className="muted" style={{ width: 60 }}>Payments</span><input type="number" inputMode="numeric" aria-label="Number of payments" min={1} max={1200} style={{ flex: 1, background: "none", border: 0, outline: "none" }} value={maxN} onChange={(e) => setMaxN(e.target.value)} /></label>}
        </div>
      </Sheet>

      {confirmDiscard && (
        <div role="alertdialog" aria-label="Discard this entry?" style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "grid", placeItems: "end center", padding: "var(--gutter)", zIndex: 60 }}>
          <div className="card" style={{ width: "100%", maxWidth: 480, background: "var(--surface-2)" }}>
            <div className="headline">Discard this entry?</div>
            <p className="sub" style={{ marginTop: 4 }}>What you’ve typed will be lost.</p>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ height: 48 }} onClick={close}>Discard</button>
              <button className="btn secondary" style={{ height: 48 }} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
