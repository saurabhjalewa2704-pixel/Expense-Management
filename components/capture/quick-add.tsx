"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deleteByClientId, deleteTransaction, restoreTransaction, updateTransaction } from "@/app/actions/transactions";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { defaultCounts, pendingFlags } from "@/lib/balance-flags";
import { dateChipLabel, todayLondon, type ISODate } from "@/lib/dates";
import { BalanceFlagBlock } from "./balance-flag-block";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP, pressKey, toPence } from "@/lib/money";
import { ordinal } from "@/lib/recurrence";
import { fetchRecurringDuplicate } from "@/lib/queries/fetchers";
import { supabaseBrowser } from "@/lib/supabase/client";
import { discard, enqueue, flushIdle, getItem, newClientId, updatePending } from "@/lib/outbox";
import { useAccounts, useCategoryTree, useLastIncomeAccount, useOutbox, usePayees, useProfile, useSuggestHistory } from "@/lib/queries/hooks";
import { TxnInput } from "@/lib/schemas/transaction";
import { suggestCategories, type HistoryRow, type Suggestion } from "@/lib/suggest";
import { requestSync } from "@/lib/sync";
import type { Account, Payee, TxnRow } from "@/lib/types";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { useIsDesktop } from "@/lib/use-media";
import { AccountPicker, DateSheet, NoteSheet } from "./pickers";
import { PotPicker } from "./pot-picker";
import { usePots } from "@/lib/queries/hooks";
import { CategoryPicker } from "./category-picker";

type Mode = "expense" | "income" | "transfer";
/** The IANA zone this device is in, stored with the entry (EC-D1). */
const deviceZone = (): string | undefined => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };
export interface QuickAddOptions { mode?: Mode; edit?: TxnRow; date?: ISODate }

const Ctx = createContext<{ open: (o?: QuickAddOptions) => void; isOpen: boolean }>({ open: () => {}, isOpen: false });
export const useQuickAdd = () => useContext(Ctx);

/**
 * The sheet's state, data hooks and code live for the whole app shell, so tapping ＋ has nothing to fetch or load (CAP-01: under
 * 100 ms). Only its DOM mounts on open: force-mounting a modal dialog makes Radix hide the whole page from assistive tech.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [options, setOptions] = useState<QuickAddOptions>({});
  const [session, setSession] = useState(0);
  const router = useRouter();
  const params = useSearchParams();

  const open = useCallback((o: QuickAddOptions = {}) => { setOptions(o); setSession((s) => s + 1); setOpen(true); }, []);

  // NOT-01: the evening reminder opens the app at /?add=1 with the date set to today.
  useEffect(() => {
    if (params.get("add") === "1") { open({ date: todayLondon() }); router.replace("/"); }
  }, [params, open, router]);

  return (
    <Ctx.Provider value={{ open, isOpen }}>
      {children}
      <QuickAddSheet open={isOpen} onOpenChange={setOpen} options={options} session={session} />
    </Ctx.Provider>
  );
}

const NO_ACCOUNTS: Account[] = [];
const NO_PAYEES: Payee[] = [];
const NO_HISTORY: HistoryRow[] = [];
const MODES: { id: Mode; label: string }[] = [{ id: "expense", label: "Expense" }, { id: "income", label: "Income" }, { id: "transfer", label: "Transfer" }];

function groupWhole(s: string) {
  const [whole = "", frac] = s.split(".");
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? g : `${g}.${frac}`;
}

function QuickAddSheet({ open, onOpenChange, options, session }: { open: boolean; onOpenChange: (o: boolean) => void; options: QuickAddOptions; session: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const { inset, viewportHeight } = useKeyboardInset();
  const profile = useProfile().data;
  const accounts = useAccounts().data ?? NO_ACCOUNTS;
  const { tree, categories } = useCategoryTree();
  const payees = usePayees().data ?? NO_PAYEES;
  const history = useSuggestHistory().data ?? NO_HISTORY;
  const lastIncomeAccount = useLastIncomeAccount().data ?? null;
  const outbox = useOutbox();

  const editing = options.edit;
  const [mode, setMode] = useState<Mode>("expense");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [payeeFocused, setPayeeFocused] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountManual, setAccountManual] = useState(false);
  const [potId, setPotId] = useState<string | null>(null);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [date, setDate] = useState<ISODate>(todayLondon());
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState<null | "category" | "account" | "counter" | "date" | "note" | "pot">(null);
  const [confirm, setConfirm] = useState<null | "discard" | "delete" | "duplicate">(null);
  const [flagAnswer, setFlagAnswer] = useState<boolean | null>(null);       // the owner's explicit answer about the balance (BAL-03); null = let the database decide
  const [dup, setDup] = useState<{ name: string; due_on: ISODate } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now()); // taken when the sheet opens, so ranking is stable while it is open
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const live = useMemo(() => accounts.filter((a) => !a.archived_at), [accounts]);
  const defaultAccount = live.find((a) => a.is_default) ?? live[0];
  const accountById = (id: string | null) => (id ? accounts.find((a) => a.id === id) : undefined);

  // ---- reset every time the sheet is opened ----
  useEffect(() => {
    if (!open) return;
    setError(undefined); setConfirm(null); setPicker(null); setBusy(false); setNowMs(Date.now()); setFlagAnswer(null);
    if (editing) {
      setMode(editing.type === "adjustment" ? "expense" : (editing.type as Mode));
      setAmount(`${Math.trunc(editing.amount_pence / 100)}.${String(editing.amount_pence % 100).padStart(2, "0")}`.replace(/\.00$/, ""));
      setPayee(editing.payee_name ?? ""); setCategoryId(editing.category_id); setAccountId(editing.account_id);
      setCounterId(editing.counter_account_id); setPotId(editing.pot_id ?? null); setDate(editing.occurred_on); setNote(editing.note ?? ""); setAutoFilled(false); setAccountManual(false);
    } else {
      setMode(options.mode ?? "expense"); setAmount(""); setPayee(""); setCategoryId(null); setAccountId(null); setCounterId(null); setPotId(null);
      setDate(options.date ?? todayLondon()); setNote(""); setAutoFilled(false); setAccountManual(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // defaults that depend on data which may still be loading when the sheet opens
  const effAccount = accountId ?? (mode === "income" ? (lastIncomeAccount && live.find((a) => a.id === lastIncomeAccount)?.id) : undefined) ?? defaultAccount?.id ?? null;
  const effCounter = counterId ?? live.find((a) => a.id !== effAccount)?.id ?? null;
  useEffect(() => { setFlagAnswer(null); }, [effAccount, date]);       // a new account or date is a new question

  const pots = usePots().data ?? [];
  const potName = pots.find((x) => x.pot_id === potId)?.name ?? "Pot";
  const kind = mode === "income" ? "income" : "expense";
  const pence = toPence(amount) ?? 0;
  const account = accountById(effAccount);
  // BAL-03: does this entry move the account's balance? The owner's answer wins; an unchanged edit keeps what the row already says.
  const sameAsSaved = !!editing && editing.account_id === effAccount && editing.occurred_on === date;
  const effCounts = flagAnswer ?? (sameAsSaved ? editing?.counts_in_balance ?? true : account ? defaultCounts(account, date) : true);
  const counter = accountById(effCounter);

  const matchedPayee = useMemo<Payee | undefined>(() => {
    const n = payee.trim().toLowerCase().replace(/\s+/g, " ");
    return n ? payees.find((p) => p.name_norm === n) : undefined;
  }, [payee, payees]);

  const payeeSuggestions = useMemo(() => {
    const q = payee.trim().toLowerCase();
    const rank = (p: Payee) => p.use_count * Math.pow(0.5, (nowMs - (p.last_used_at ? Date.parse(p.last_used_at) : 0)) / (30 * 86_400_000));
    return payees
      .filter((p) => (q ? p.name_norm.includes(q) : true) && p.name_norm !== q)
      .sort((a, b) => Number(b.name_norm.startsWith(q)) - Number(a.name_norm.startsWith(q)) || rank(b) - rank(a))
      .slice(0, 4);
  }, [payee, payees, nowMs]);

  const chips = useMemo(() => {
    if (mode === "transfer") return [];
    if (mode === "income") return tree.parents("income").slice(0, 6).map((c): Suggestion => ({ categoryId: c.id, label: c.name }));
    const pending = outbox.filter((i) => i.status === "pending" && i.payload.type === "expense" && i.payload.category_id)
      .map((i) => ({ category_id: i.payload.category_id!, occurred_on: i.payload.occurred_on, at: new Date(i.created_at).toISOString() }));
    return suggestCategories({
      history: [...pending, ...history], categories, now: new Date(nowMs), today: todayLondon(nowMs),
      payeeCategoryId: matchedPayee?.default_category_id ?? null,
    });
  }, [mode, tree, history, categories, matchedPayee, outbox, nowMs]);

  // a category picked from the full list leads the cards, with its parent beside it
  const picked = categoryId ? tree.byId.get(categoryId) : undefined;
  const chipList: Suggestion[] = picked && !chips.some((c) => c.categoryId === picked.id)
    ? [{ categoryId: picked.id, label: picked.name, parentLabel: picked.parent_id ? tree.byId.get(picked.parent_id)?.name : undefined }, ...chips.slice(0, 5)] : chips;

  const dirty = !editing && (amount !== "" || payee !== "" || note !== "");

  const close = () => {
    clearTimeout(clearTimer.current);
    setConfirm(null);
    onOpenChange(false);
  };
  const requestClose = (o: boolean) => {
    if (o) return onOpenChange(true);
    if (picker) return;
    if (dirty) return setConfirm("discard");
    close();
  };

  // ---- behaviour ----
  const press = (k: string) => { setError(undefined); setAmount((a) => pressKey(a, k)); };
  const chooseAccount = (id: string) => { setAccountId(id); setAccountManual(true); };

  const applyPayee = (p: Payee) => {
    setPayee(p.name);
    setPayeeFocused(false);
    const cat = p.default_category_id ? tree.byId.get(p.default_category_id) : undefined;
    if (cat && !cat.archived_at && cat.kind === kind) setCategoryId(cat.id);
    const acc = p.default_account_id ? live.find((a) => a.id === p.default_account_id) : undefined;
    if (acc) { setAccountId(acc.id); setAccountManual(false); }
    setAutoFilled(true);
  };
  const onPayeeChange = (v: string) => {
    setPayee(v);
    const n = v.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = n ? payees.find((p) => p.name_norm === n) : undefined;
    if (hit) {
      const cat = hit.default_category_id ? tree.byId.get(hit.default_category_id) : undefined;
      if (cat && !cat.archived_at && cat.kind === kind) setCategoryId(cat.id);
      const acc = hit.default_account_id ? live.find((a) => a.id === hit.default_account_id) : undefined;
      if (acc && !accountManual) setAccountId(acc.id);
      setAutoFilled(true);
    } else setAutoFilled(false);
  };

  const buildInput = (category: string | null): TxnInput => ({
    client_id: editing?.client_id ?? newClientId(),
    type: mode, amount_pence: pence, account_id: effAccount ?? "",
    counter_account_id: mode === "transfer" ? effCounter : null,
    category_id: mode === "transfer" ? null : category,
    payee: mode === "transfer" ? null : payee.trim() || null, note: note.trim() || null, tags: [],
    occurred_on: date, occurred_at: !editing && date === todayLondon() ? new Date().toISOString() : (editing?.occurred_at ?? null),
    account_manual: accountManual, source: "app",
    pot_id: mode === "transfer" ? null : potId,
    counts_in_balance: flagAnswer, occurred_tz: !editing ? deviceZone() : undefined,
  });

  const canSave = pence > 0 && !!effAccount && (mode === "transfer" ? !!effCounter && effCounter !== effAccount : !!categoryId || !!potId);

  const save = async (categoryOverride?: string, skipDuplicateCheck = false) => {
    if (busy) return;
    const category = categoryOverride ?? categoryId;
    const input = buildInput(category);
    const parsed = TxnInput.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the entry.");
    setBusy(true);

    if (editing) {
      if (editing.pending) {
        await updatePending(editing.client_id, input);
        close(); requestSync(); toast({ message: "Saved", duration: 2500 });
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) { setBusy(false); return setError("You're offline. Edits need a connection; new entries can still be added."); }
      const { client_id: _c, account_manual: _m, source: _s, ...patch } = input;
      void _c; void _m; void _s;
      const r = await updateTransaction(editing.id, patch);
      setBusy(false);
      if (!r.ok) return setError(r.error);
      await qc.invalidateQueries();
      close(); toast({ message: "Saved", duration: 2500 });
      return;
    }

    // REC-08: a bill for this payee is logged automatically around this date, so ask before adding the same payment by hand
    if (!skipDuplicateCheck && mode === "expense" && matchedPayee && typeof navigator !== "undefined" && navigator.onLine) {
      const hit = await fetchRecurringDuplicate(supabaseBrowser(), matchedPayee.id, date).catch(() => null);
      if (hit) { setBusy(false); setDup({ name: hit.payee_name, due_on: hit.due_on }); setConfirm("duplicate"); return; }
    }

    await enqueue(input, pendingFlags(mode, date, account, mode === "transfer" ? counter : undefined, { a: flagAnswer }));
    close();
    const catName = category ? tree.byId.get(category)?.name : undefined;
    const message = mode === "transfer"
      ? `Moved ${formatGBP(pence)} · ${account?.name} → ${counter?.name}`
      : `Added ${mode === "income" ? "income " : ""}${formatGBP(pence)}${catName ? ` · ${catName}` : ""}`;
    toast({
      message,
      action: { label: "Undo", onClick: () => undo(input.client_id) },
    });
    requestSync();
  };

  /** Undo removes the entry completely. If it has already reached the server it is soft-deleted there. */
  const undo = async (clientId: string) => {
    const item = await getItem(clientId);
    if (item && !item.confirmed_at) {
      await discard(clientId);
      await flushIdle(); // a send may have been in flight when Undo was tapped
    } else {
      await discard(clientId);
    }
    if (typeof navigator === "undefined" || navigator.onLine) await deleteByClientId(clientId);
    await qc.invalidateQueries();
  };

  const remove = async () => {
    if (!editing) return;
    if (editing.pending) { await discard(editing.client_id); close(); return; }
    setBusy(true);
    const r = await deleteTransaction(editing.id);
    setBusy(false);
    if (!r.ok) { setConfirm(null); return setError(r.error); }
    await qc.invalidateQueries();
    close();
    toast({ message: "Transaction deleted", action: { label: "Undo", onClick: async () => { await restoreTransaction(editing.id); await qc.invalidateQueries(); } } });
  };

  const tapChip = (id: string) => {
    if (potId && categoryId === id) { setCategoryId(null); return; }          // in a pot a category is optional: tap again to clear it
    setCategoryId(id);
    setError(undefined);
    // CAP-01: with a remembered payee, tapping a category IS the save action (setting "Tap category to save").
    if (!editing && autoFilled && profile?.tap_to_save !== false && pence > 0 && mode !== "transfer") void save(id);
  };

  // keyboard: digits go to the amount unless a text field has focus (desktop)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea")) { if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type === "text") (t as HTMLInputElement).blur(); return; }
    if (/^\d$/.test(e.key) || e.key === ".") { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    // Enter saves, except on a button that Enter should simply press (the keypad, pickers, Add itself)
    else if (e.key === "Enter" && canSave && (t.tagName !== "BUTTON" || t.getAttribute("role") === "radio" || t.getAttribute("role") === "tab")) { e.preventDefault(); void save(); }
  };

  // Touch and pen act on pointerdown (no 300ms wait, no double-fire with the click that follows); mouse and keyboard use click.
  const byPointer = useRef(false);
  const keyHandlers = (k: string) => ({
    onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== "mouse") { e.preventDefault(); byPointer.current = true; press(k); } },
    onPointerUp: () => { setTimeout(() => { byPointer.current = false; }, 400); },
    onClick: () => { if (byPointer.current) { byPointer.current = false; return; } press(k); },
  });

  const backTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backDown = () => { backTimer.current = setTimeout(() => { setAmount(""); backTimer.current = undefined; }, 450); };
  const backUp = () => { if (backTimer.current) { clearTimeout(backTimer.current); backTimer.current = undefined; press("back"); } };

  const typing = payeeFocused && mode !== "transfer";
  const display = groupWhole(amount || "0");
  const buttonLabel = editing ? "Save changes" : mode === "transfer" ? `Transfer ${formatGBP(pence)}` : `Add ${mode === "income" ? "income " : ""}${formatGBP(pence)}`;

  return (
    <Sheet
      open={open} onOpenChange={requestClose} title={editing ? "Edit transaction" : "Add transaction"}
      bottomInset={isDesktop ? 0 : inset} maxHeight={!isDesktop && viewportHeight ? `${Math.floor(viewportHeight - 8)}px` : undefined} handle={false}
    >
      <div className="vaul-body" onKeyDown={onKeyDown} data-testid="quick-add" style={{ paddingBottom: 4 }}>
        <div className="qa-head">
          <button className="qa-x" aria-label="Close" onClick={() => requestClose(false)}><UI.X size={18} strokeWidth={2} aria-hidden /></button>
          <span className="t">{editing ? "Edit transaction" : mode === "income" ? "New income" : mode === "transfer" ? "New transfer" : "New expense"}</span>
          <span className="qa-x" aria-hidden style={{ visibility: "hidden" }} />
        </div>
        <div className="seg" role="tablist" aria-label="Type">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} disabled={!!editing && editing.type !== m.id}
              onClick={() => { setMode(m.id); setCategoryId(null); setAutoFilled(false); setAccountId(null); setError(undefined); if (m.id === "transfer") setPotId(null); }}>
              {m.label}
            </button>
          ))}
        </div>

        <div className={`amount num`} aria-label={`Amount ${formatGBP(pence)}`} style={mode === "income" ? { color: "var(--positive)" } : undefined}>
          <span className="cur">£</span>
          <span className="whole" style={amount === "" ? { color: "var(--ink-3)" } : undefined} data-testid="amount">{display}</span>
          <span className="caret" aria-hidden />
        </div>

        {mode !== "transfer" ? (
          <>
            <label className="payee">
              <UI.Search size={18} strokeWidth={1.75} className="faint" aria-hidden />
              <input
                className="v" style={{ background: "none", border: 0, outline: "none", minWidth: 0 }} placeholder="Where?" aria-label="Payee" autoComplete="off" autoCapitalize="words"
                value={payee} onChange={(e) => onPayeeChange(e.target.value)} onFocus={() => setPayeeFocused(true)} onBlur={() => setTimeout(() => setPayeeFocused(false), 120)} maxLength={80}
              />
              {matchedPayee && <span className="learned"><UI.Check size={14} strokeWidth={2} aria-hidden />Remembered</span>}
            </label>
            {typing && payeeSuggestions.length > 0 && (
              <div className="subs" style={{ marginTop: 8 }} role="listbox" aria-label="Payee suggestions">
                {payeeSuggestions.map((p) => (
                  <button key={p.id} role="option" aria-selected={false} className="row" style={{ width: "100%", textAlign: "left", minHeight: 46 }} onMouseDown={(e) => e.preventDefault()} onClick={() => applyPayee(p)}>
                    <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>{p.name}</div>
                      {p.default_category_id && <div className="row-s">{tree.byId.get(p.default_category_id)?.name}</div>}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="cat-head">
              <span className="eyebrow">{potId ? "Category (optional)" : mode === "income" ? "Income type" : "Your top categories"}</span>
              <button className="link" onClick={() => setPicker("category")} aria-label="More categories">All categories <UI.ChevronRight size={14} strokeWidth={2} aria-hidden /></button>
            </div>
            <div className="qcards" role="radiogroup" aria-label="Category">
              {(potId ? chipList.slice(0, 4) : chipList).map((c) => (
                <button key={c.categoryId} role="radio" aria-checked={categoryId === c.categoryId} aria-label={c.label} title={c.parentLabel ? `${c.parentLabel} › ${c.label}` : c.label}
                  className={`qcard ${categoryId === c.categoryId ? "sel" : ""}`} onClick={() => tapChip(c.categoryId)} data-testid="qcard">
                  <span className="qi"><CategoryIcon name={tree.byId.get(c.categoryId)?.icon} size={18} /></span>
                  <span className="qt"><b>{c.label}</b>{c.parentLabel && <small>{c.parentLabel}</small>}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <button className="payee" style={{ width: "100%", textAlign: "left" }} onClick={() => setPicker("account")} aria-label={`From ${account?.name ?? "choose account"}`}>
              <span className="learned" style={{ width: 40 }}>From</span><span className="v">{account?.name ?? "Choose account"}</span><UI.ChevronRight size={18} strokeWidth={1.75} className="chev" />
            </button>
            <button className="payee" style={{ width: "100%", textAlign: "left" }} onClick={() => setPicker("counter")} aria-label={`To ${counter?.name ?? "choose account"}`}>
              <span className="learned" style={{ width: 40 }}>To</span><span className="v">{counter?.name ?? "Choose account"}</span><UI.ChevronRight size={18} strokeWidth={1.75} className="chev" />
            </button>
          </div>
        )}

        {!typing && (
          <>
            <div className="meta">
              {mode !== "transfer" && (
                <button className="chip" onClick={() => setPicker("account")} aria-label={`Account ${account?.name ?? ""}`}>
                  <UI.CreditCard size={16} strokeWidth={1.75} aria-hidden />{account?.name ?? "Account"}
                </button>
              )}
              <button className="chip" onClick={() => setPicker("date")} aria-label={`Date ${dateChipLabel(date)}`}>
                <UI.Calendar size={16} strokeWidth={1.75} aria-hidden />{dateChipLabel(date)}
              </button>
              {mode !== "transfer" && (
                <button className={`chip ${potId ? "sel" : ""}`} onClick={() => setPicker("pot")} aria-label={potId ? `One-off pot ${potName}` : "One-off pot"} style={{ maxWidth: potId ? 112 : 150, ...(potId ? {} : { padding: "0 11px" }) }}>
                  <UI.PiggyBank size={16} strokeWidth={1.75} aria-hidden />{potId && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{potName}</span>}
                </button>
              )}
              <button className="chip" onClick={() => setPicker("note")} aria-label="Note" style={{ maxWidth: 150, ...(potId && !note ? { padding: "0 11px" } : {}) }}>
                <UI.FileText size={16} strokeWidth={1.75} aria-hidden />{(note || !potId) && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{note ? note : "Note"}</span>}
              </button>
            </div>

            {mode !== "transfer" && (
              <BalanceFlagBlock account={account} accountName={account?.name ?? "account"} date={date} counts={effCounts} editing={!!editing} trackingStart={profile?.tracking_started_on}
                onAnswer={setFlagAnswer} />
            )}

            {potId && mode !== "transfer" && <p className="sub" data-testid="pot-note" style={{ margin: "8px 2px 0" }}>In “{potName}”. No category needed. Kept out of monthly spend.</p>}

            <div className="keypad num" role="group" aria-label="Amount keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => (
                <button key={k} className="key" aria-label={k === "." ? "Decimal point" : k} {...keyHandlers(k)}>{k}</button>
              ))}
              <button className="key fn" aria-label="Delete" onPointerDown={backDown} onPointerUp={backUp} onPointerLeave={() => { if (backTimer.current) { clearTimeout(backTimer.current); backTimer.current = undefined; } }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press("back"); } }}>
                <UI.Delete size={24} strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}

        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 10 }}>{error}</p>}
        <button className="btn" style={{ marginTop: 14, opacity: canSave && !busy ? 1 : 0.4 }} disabled={!canSave || busy} onClick={() => save()}>{buttonLabel}</button>
        {editing && (
          <button className="btn secondary" style={{ marginTop: 10, color: "var(--danger)", height: 48 }} onClick={() => setConfirm("delete")}>Delete transaction</button>
        )}
      </div>

      {confirm === "duplicate" && dup && (
        <div role="alertdialog" aria-label="Already logged automatically" style={{ position: "absolute", inset: 0, background: "var(--scrim)", borderRadius: "var(--r-sheet)", display: "grid", placeItems: "end center", padding: "var(--gutter)", zIndex: 5 }}>
          <div className="card" style={{ width: "100%", background: "var(--surface-2)" }}>
            <div className="headline" data-testid="dup-title">{dup.name} is logged automatically on the {ordinal(Number(dup.due_on.slice(8)))}.</div>
            <p className="sub" style={{ marginTop: 4 }}>Add this as well?</p>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ height: 48 }} onClick={() => { setConfirm(null); void save(undefined, true); }}>Add anyway</button>
              <button className="btn secondary" style={{ height: 48 }} onClick={() => { setConfirm(null); setDup(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirm && confirm !== "duplicate" && (
        <div role="alertdialog" aria-label={confirm === "discard" ? "Discard this entry?" : "Delete this transaction?"} style={{ position: "absolute", inset: 0, background: "var(--scrim)", borderRadius: "var(--r-sheet)", display: "grid", placeItems: "end center", padding: "var(--gutter)", zIndex: 5 }}>
          <div className="card" style={{ width: "100%", background: "var(--surface-2)" }}>
            <div className="headline">{confirm === "discard" ? "Discard this entry?" : "Delete this transaction?"}</div>
            <p className="sub" style={{ marginTop: 4 }}>{confirm === "discard" ? "What you've typed will be lost." : "You can undo this for a few seconds afterwards."}</p>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ height: 48, background: confirm === "delete" ? "var(--danger)" : "var(--ink)", color: confirm === "delete" ? "var(--ink)" : "var(--on-ink)" }} onClick={() => (confirm === "discard" ? close() : remove())}>
                {confirm === "discard" ? "Discard" : "Delete"}
              </button>
              <button className="btn secondary" style={{ height: 48 }} onClick={() => setConfirm(null)}>Keep editing</button>
            </div>
          </div>
        </div>
      )}

      <CategoryPicker open={picker === "category"} onOpenChange={(o) => setPicker(o ? "category" : null)} kind={kind} selectedId={categoryId}
        onSelect={(id) => { setCategoryId(id); setError(undefined); }} suggestedIds={chips.map((c) => c.categoryId)} />
      <AccountPicker open={picker === "account"} onOpenChange={(o) => setPicker(o ? "account" : null)} title={mode === "transfer" ? "From" : "Account"} selectedId={effAccount}
        excludeId={mode === "transfer" ? effCounter : undefined} onSelect={chooseAccount} />
      <AccountPicker open={picker === "counter"} onOpenChange={(o) => setPicker(o ? "counter" : null)} title="To" selectedId={effCounter} excludeId={effAccount} onSelect={(id) => setCounterId(id)} />
      <PotPicker open={picker === "pot"} onOpenChange={(o) => setPicker(o ? "pot" : null)} selectedId={potId} onSelect={setPotId} />
      <DateSheet open={picker === "date"} onOpenChange={(o) => setPicker(o ? "date" : null)} value={date} min={(account as Account | undefined)?.opening_date} onChange={setDate} />
      <NoteSheet open={picker === "note"} onOpenChange={(o) => setPicker(o ? "note" : null)} value={note} onChange={setNote} />
    </Sheet>
  );
}

