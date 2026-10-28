"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { deleteTrip, previewTripDates, saveTrip } from "@/app/actions/trips";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon, UI } from "@/lib/icons";
import { COUNTRIES, countryOf, CURRENCIES, flagOf } from "@/lib/countries";
import { addMonths, diffDays, formatDayMonth, formatMonthYear, formatShort, monthEnd, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { formatGBP, toPence } from "@/lib/money";
import { useCategoryTree, useToday, useTripBudgets, useTripStops, useTrips } from "@/lib/queries/hooks";
import { TripInput } from "@/lib/schemas/trip";
import { plural, rangeLabel } from "./shared";

interface StopDraft { name: string; start_on: ISODate; end_on: ISODate }
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** Tap the start date, then the end date; the range is highlighted (TRIP-03). */
function RangeCalendar({ start, end, onPick, initialMonth }: { start: ISODate | null; end: ISODate | null; onPick: (d: ISODate) => void; initialMonth: ISODate }) {
  const [month, setMonth] = useState<ISODate>(monthStart(initialMonth));
  const from = monthStart(month), n = Number(monthEnd(month).slice(8));
  const lead = weekdayIndex(from);
  const cells: (ISODate | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, "0")}`)];
  return (
    <div data-testid="trip-calendar">
      <div className="cal-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(from, -1))}><UI.ChevronLeft size={16} strokeWidth={2} aria-hidden /></button>
        <span className="m" data-testid="trip-cal-month">{formatMonthYear(from)}</span>
        <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(from, 1))}><UI.ChevronRight size={16} strokeWidth={2} aria-hidden /></button>
      </div>
      <div className="cal-range">
        {DOW.map((d, i) => <span key={i} className="wk" aria-hidden>{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`p${i}`} />;
          const edge = d === start || d === end;
          const inside = !!start && !!end && d >= start && d <= end;
          return (
            <button key={d} data-day={d} aria-label={formatShort(d)} aria-pressed={edge} onClick={() => onPick(d)}
              className={`${inside ? "in" : ""}${edge ? " edge" : ""}${inside && d === start ? " s" : ""}${inside && d === end ? " e" : ""}`}>{Number(d.slice(8))}</button>
          );
        })}
      </div>
    </div>
  );
}

function SearchList<T extends { key: string }>({ open, onOpenChange, title, items, render, onPick, placeholder }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; items: T[]; render: (i: T) => React.ReactNode; onPick: (i: T) => void; placeholder: string;
}) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.key.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }} title={title}>
      <div className="vaul-body">
        <div className="sheet-head"><span /><span className="t">{title}</span><button className="txt" onClick={() => onOpenChange(false)}>Done</button></div>
        <label className="field" style={{ marginTop: 4 }}><UI.Search size={16} strokeWidth={1.75} aria-hidden /><input aria-label={`Search ${title.toLowerCase()}`} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, background: "none", border: 0, outline: "none" }} /></label>
        <div className="subs" style={{ marginTop: 8, maxHeight: "52dvh", overflowY: "auto" }}>
          {shown.map((i) => <button key={i.key} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { onPick(i); onOpenChange(false); setQ(""); }}>{render(i)}</button>)}
          {shown.length === 0 && <p className="sub" style={{ padding: 16 }}>Nothing matches “{q}”.</p>}
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

/** TRIP-03: New / Edit trip, full screen. `id` set = edit. */
export function TripForm({ id }: { id?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const { tree } = useCategoryTree();
  const trips = useTrips();
  const trip = id ? (trips.data ?? []).find((t) => t.id === id) : undefined;
  const savedStops = useTripStops(id);
  const savedBudgets = useTripBudgets(id ?? "");

  const [name, setName] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [currency, setCurrency] = useState("GBP");
  const [start, setStart] = useState<ISODate | null>(null);
  const [end, setEnd] = useState<ISODate | null>(null);
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [budget, setBudget] = useState("");
  const [catBudgets, setCatBudgets] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(true);
  const [outside, setOutside] = useState<"keep" | "remove">("keep");
  const [addInRange, setAddInRange] = useState(false);
  const [picker, setPicker] = useState<null | "country" | "currency" | "dates" | "cats">(null);
  const [confirm, setConfirm] = useState<null | "discard" | "delete">(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!id);
  const [preview, setPreview] = useState<{ outside: number; inRange: number; firstInRange: string | null; lastInRange: string | null } | null>(null);

  // editing: fill the form from the saved trip, once everything has arrived
  useEffect(() => {
    if (!trip || loaded || !savedStops.data || !savedBudgets.data) return;
    setName(trip.name); setCountry(trip.country_code); setCurrency(trip.currency); setStart(trip.start_on); setEnd(trip.end_on);
    setBudget(trip.budget_pence ? String(trip.budget_pence / 100) : ""); setAuto(trip.auto_tag);
    setStops(savedStops.data.map((s) => ({ name: s.name, start_on: s.start_on, end_on: s.end_on })));
    setCatBudgets(Object.fromEntries(savedBudgets.data.map((b) => [b.category_id, String(b.amount_pence / 100)])));
    setLoaded(true);
  }, [trip, loaded, savedStops.data, savedBudgets.data]);

  const catRows = useMemo(() => tree.parents("expense"), [tree]);
  const budgetPence = budget.trim() === "" ? null : toPence(budget);
  const catList = Object.entries(catBudgets).map(([category_id, v]) => ({ category_id, amount_pence: toPence(v) ?? 0 })).filter((b) => b.amount_pence > 0);
  const catSum = catList.reduce((a, b) => a + b.amount_pence, 0);
  const length = start && end ? diffDays(end, start) + 1 : 0;

  // TRIP-03 / EC-T1: trips cannot overlap, and the message names the one in the way
  const clash = start && end ? (trips.data ?? []).find((t) => t.id !== id && t.start_on <= end && t.end_on >= start) : undefined;

  // editing the dates: ask what to do with tagged expenses now outside, and offer untagged ones now inside (EC-T2)
  const datesChanged = !!trip && !!start && !!end && (start !== trip.start_on || end !== trip.end_on);
  useEffect(() => {
    setPreview(null);
    if (!id || !datesChanged || !start || !end || end < start) return;
    let live = true;
    previewTripDates(id, start, end).then((r) => { if (live && r.ok) setPreview(r.data); });
    return () => { live = false; };
  }, [id, datesChanged, start, end]);

  const input = {
    name, country_code: country, currency, start_on: start ?? "", end_on: end ?? "", budget_pence: budgetPence ?? (catSum > 0 ? catSum : null),
    auto_tag: auto, stops, category_budgets: catList, outside, add_in_range: addInRange,
  };
  const valid = TripInput.safeParse(input);
  const budgetBad = budget.trim() !== "" && (budgetPence === null || budgetPence <= 0);
  const canSave = valid.success && !!start && !!end && !clash && !budgetBad && !busy && (!id || loaded);
  const dirty = !id && (name !== "" || start !== null || stops.length > 0 || budget !== "");
  const hint = !valid.success && (name !== "" || start !== null) ? valid.error.issues[0]?.message : undefined;

  const pickDate = (d: ISODate) => {
    if (!start || (start && end)) { setStart(d); setEnd(null); }
    else if (d < start) setStart(d);
    else setEnd(d);
  };
  const close = () => (id ? router.back() : router.replace("/trips"));
  const save = async () => {
    setBusy(true); setError(undefined);
    const r = await saveTrip(id ?? null, input);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: id ? "Trip saved" : `${name.trim()} created` });
    router.replace(id ? `/trips/${id}` : `/trips/${r.data.id}?bookings=1`);
  };
  const remove = async () => {
    if (!id) return;
    setBusy(true);
    const r = await deleteTrip(id);
    setBusy(false);
    if (!r.ok) { setConfirm(null); return setError(r.error); }
    await qc.invalidateQueries();
    toast({ message: "Trip deleted. Its expenses are still in Activity." });
    router.replace("/trips");
  };

  const setStop = (i: number, patch: Partial<StopDraft>) => setStops((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const addStop = () => {
    if (!start || !end) return;
    const last = stops.at(-1);
    const from = last ? (last.end_on < end ? addDay(last.end_on) : end) : start;
    setStops((s) => [...s, { name: "", start_on: from, end_on: end }]);
  };

  return (
    <div className="fullpage" data-testid="trip-form">
      <div className="fullpage-in">
        <div className="fp-bar">
          <button className="icon-btn" aria-label="Close" onClick={() => (dirty ? setConfirm("discard") : close())}><UI.X size={18} strokeWidth={2} aria-hidden /></button>
          <h1 className="fp-title">{id ? "Edit trip" : "New trip"}</h1>
          <button className="btn" style={{ width: "auto", height: 40, padding: "0 20px", opacity: canSave ? 1 : 0.4 }} disabled={!canSave} onClick={save} data-testid="trip-save">{id ? "Save" : "Create"}</button>
        </div>

        <div className="list" style={{ marginTop: 14 }}>
          <label className="row"><div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Name</div></div>
            <input aria-label="Trip name" placeholder="USA" maxLength={30} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} data-testid="trip-name"
              style={{ background: "none", border: 0, outline: "none", textAlign: "right", minWidth: 0, width: "62%", color: "var(--ink)" }} /></label>
          <Rowish label="Where" value={country ? `${flagOf(country)} ${countryOf(country)?.name ?? country}` : "Choose a country"} onClick={() => setPicker("country")} testId="trip-country" muted={!country} />
          <Rowish label="Local currency" value={currency} onClick={() => setPicker("currency")} testId="trip-currency" />
        </div>
        {currency === "GBP" && <p className="sub" style={{ margin: "8px 4px 0" }}>Spending in pounds, so there’s nothing to convert on this trip.</p>}

        <div className="list" style={{ marginTop: 12 }}>
          <Rowish label="Dates" value={start && end ? `${rangeLabel(start, end)}` : start ? `${formatShort(start)} – ?` : "Choose dates"} onClick={() => setPicker("dates")} testId="trip-dates" muted={!start} />
          {length > 0 && <div className="row"><div className="row-main"><div className="row-t" style={{ fontWeight: 400, color: "var(--ink-2)" }}>Length</div></div><span data-testid="trip-length">{plural(length, "day")}</span></div>}
        </div>
        {clash && <p role="alert" className="callout" style={{ color: "var(--caution)", margin: "10px 4px" }} data-testid="trip-clash">These dates overlap {clash.name} ({formatDayMonth(clash.start_on)} – {formatDayMonth(clash.end_on)} {clash.end_on.slice(0, 4)}). Trips can’t overlap.</p>}

        {preview && preview.outside > 0 && (
          <div className="card" style={{ marginTop: 12 }} data-testid="trip-outside">
            <div className="headline">{plural(preview.outside, "expense")} {preview.outside === 1 ? "is" : "are"} now outside the trip dates.</div>
            <div className="seg" role="radiogroup" aria-label="Expenses outside the dates" style={{ marginTop: 10 }}>
              <button role="radio" aria-checked={outside === "keep"} className={outside === "keep" ? "on" : ""} onClick={() => setOutside("keep")}>Keep them on the trip</button>
              <button role="radio" aria-checked={outside === "remove"} className={outside === "remove" ? "on" : ""} onClick={() => setOutside("remove")}>Remove them</button>
            </div>
            <p className="sub" style={{ marginTop: 8 }}>Bookings made before the trip always stay.</p>
          </div>
        )}
        {preview && preview.inRange > 0 && (
          <div className="card" style={{ marginTop: 12 }} data-testid="trip-inside">
            <div className="row-between"><div className="headline">Add {plural(preview.inRange, "expense")}{preview.firstInRange ? ` from ${preview.firstInRange === preview.lastInRange ? formatDayMonth(preview.firstInRange) : `${formatDayMonth(preview.firstInRange).split(" ")[0]}–${formatDayMonth(preview.lastInRange ?? preview.firstInRange)}`}` : ""}?</div>
              <Switch label="Add expenses now inside the dates" checked={addInRange} onChange={setAddInRange} /></div>
          </div>
        )}

        <div className="section-h"><h2>Stops</h2><span className="sub">Optional · {stops.length}/8</span></div>
        <div className="list" data-testid="trip-stops">
          {stops.map((s, i) => (
            <div key={i} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <input aria-label={`Stop ${i + 1} name`} placeholder="Chicago" maxLength={40} value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} style={{ flex: 1, minWidth: 0, background: "none", border: 0, outline: "none", color: "var(--ink)", fontSize: 16 }} />
              <button className="icon-btn" aria-label={`Remove stop ${i + 1}`} onClick={() => setStops((x) => x.filter((_, k) => k !== i))}><UI.X size={16} strokeWidth={2} aria-hidden /></button>
              <div style={{ display: "flex", gap: 8, width: "100%" }}>
                <input type="date" aria-label={`Stop ${i + 1} starts`} min={start ?? undefined} max={end ?? undefined} value={s.start_on} onChange={(e) => setStop(i, { start_on: e.target.value })} className="field" style={{ flex: 1 }} />
                <input type="date" aria-label={`Stop ${i + 1} ends`} min={s.start_on} max={end ?? undefined} value={s.end_on} onChange={(e) => setStop(i, { end_on: e.target.value })} className="field" style={{ flex: 1 }} />
              </div>
            </div>
          ))}
          <button className="row" style={{ width: "100%", textAlign: "left", opacity: start && end && stops.length < 8 ? 1 : 0.5 }} disabled={!start || !end || stops.length >= 8} onClick={addStop} data-testid="trip-add-stop">
            <div className="tile"><UI.Plus size={18} strokeWidth={1.75} aria-hidden /></div><div className="row-main"><div className="row-t">Add a stop</div>{!start && <div className="row-s">Choose the dates first</div>}</div>
          </button>
        </div>

        <div className="section-h"><h2>Budget</h2><span className="sub">Optional</span></div>
        <div className="list">
          <label className="row"><div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Trip budget</div></div>
            <span className="muted">£</span>
            <input aria-label="Trip budget" inputMode="decimal" placeholder={catSum > 0 ? String(catSum / 100) : "0"} value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="trip-budget"
              style={{ background: "none", border: 0, outline: "none", textAlign: "right", width: 100, color: "var(--ink)" }} /></label>
          <Rowish label="Budget by category" value={catSum > 0 ? `${formatGBP(catSum)} set` : "None"} onClick={() => setPicker("cats")} testId="trip-cat-budgets" muted={catSum === 0} />
        </div>
        {budgetBad && <p role="alert" className="callout" style={{ color: "var(--caution)", margin: "10px 4px" }}>Enter a budget as an amount in pounds.</p>}
        {catSum > 0 && budget.trim() === "" && <p className="sub" style={{ margin: "8px 4px 0" }}>With no overall budget, the trip budget is the categories added together: {formatGBP(catSum)}.</p>}

        <div className="list" style={{ marginTop: 12 }}>
          <div className="row"><div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Add expenses automatically</div><div className="row-s">Anything you spend during these dates is tagged to the trip</div></div>
            <Switch label="Add expenses automatically" checked={auto} onChange={setAuto} /></div>
        </div>
        {!id && <p className="f-note"><UI.Info size={16} strokeWidth={1.75} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>After you create the trip, Sterling looks through the last 12 months for flights and hotels you’ve already paid for, so you can add them.</span></p>}

        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", margin: "10px 4px" }} data-testid="trip-error">{error}</p>}
        {hint && !error && !clash && <p className="sub" style={{ margin: "6px 4px" }} data-testid="trip-hint">{hint}</p>}
        {id && <button className="btn secondary" style={{ marginTop: 20, color: "var(--danger)" }} onClick={() => setConfirm("delete")} data-testid="trip-delete">Delete trip</button>}
        <div style={{ height: 40 }} />
      </div>

      <SearchList open={picker === "country"} onOpenChange={(o) => setPicker(o ? "country" : null)} title="Where" placeholder="Search countries" items={COUNTRIES.map((c) => ({ ...c, key: c.name }))}
        render={(c) => <><span style={{ width: 28 }}>{flagOf(c.code)}</span><div className="row-main"><div className="row-t">{c.name}</div></div><span className="sub">{c.currency}</span></>}
        onPick={(c) => { setCountry(c.code); setCurrency(c.currency); if (!name.trim()) setName(c.code === "US" ? "USA" : c.name); }} />
      <SearchList open={picker === "currency"} onOpenChange={(o) => setPicker(o ? "currency" : null)} title="Currency" placeholder="Search currencies" items={CURRENCIES.map((c) => ({ key: c }))}
        render={(c) => <><div className="row-main"><div className="row-t">{c.key}</div></div>{currency === c.key && <UI.Check size={16} strokeWidth={2.5} aria-hidden />}</>} onPick={(c) => setCurrency(c.key)} />

      <Sheet open={picker === "dates"} onOpenChange={(o) => setPicker(o ? "dates" : null)} title="Dates">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">Dates</span><button className="txt" onClick={() => setPicker(null)} data-testid="trip-dates-done">Done</button></div>
          <p className="sub" style={{ textAlign: "center", marginBottom: 8 }}>{!start ? "Tap the first day" : !end ? "Now tap the last day" : `${rangeLabel(start, end)} · ${plural(length, "day")}`}</p>
          <RangeCalendar start={start} end={end} onPick={pickDate} initialMonth={start ?? today} />
        </div>
      </Sheet>

      <Sheet open={picker === "cats"} onOpenChange={(o) => setPicker(o ? "cats" : null)} title="Budget by category">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">Budget by category</span><button className="txt" onClick={() => setPicker(null)}>Done</button></div>
          <div className="subs" style={{ marginTop: 0, maxHeight: "56dvh", overflowY: "auto" }}>
            {catRows.map((c) => (
              <label key={c.id} className="row">
                <div className="tile"><CategoryIcon name={c.icon} size={18} /></div>
                <div className="row-main"><div className="row-t">{c.name}</div></div>
                <span className="muted">£</span>
                <input aria-label={`${c.name} budget`} inputMode="decimal" placeholder="0" value={catBudgets[c.id] ?? ""} onChange={(e) => setCatBudgets((m) => ({ ...m, [c.id]: e.target.value }))} style={{ background: "none", border: 0, outline: "none", textAlign: "right", width: 84, color: "var(--ink)" }} />
              </label>
            ))}
          </div>
          {budgetPence !== null && catSum > budgetPence && <p role="alert" className="callout" style={{ color: "var(--caution)", margin: "10px 4px" }}>The trip budget has to be at least the category budgets added together ({formatGBP(catSum)}).</p>}
        </div>
      </Sheet>

      {confirm && (
        <div role="alertdialog" aria-label={confirm === "delete" ? "Delete this trip?" : "Discard this trip?"} style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "grid", placeItems: "end center", padding: "var(--gutter)", zIndex: 60 }}>
          <div className="card" style={{ width: "100%", maxWidth: 480, background: "var(--surface-2)" }}>
            <div className="headline">{confirm === "delete" ? `Delete ${trip?.name ?? "this trip"}?` : "Discard this trip?"}</div>
            <p className="sub" style={{ marginTop: 4 }}>{confirm === "delete" ? "Its expenses stay in Activity as normal transactions. Only the trip is removed." : "What you’ve entered will be lost."}</p>
            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ height: 48 }} onClick={confirm === "delete" ? remove : close} data-testid="trip-confirm">{confirm === "delete" ? "Delete trip" : "Discard"}</button>
              <button className="btn secondary" style={{ height: 48 }} onClick={() => setConfirm(null)}>{confirm === "delete" ? "Keep trip" : "Keep editing"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const addDay = (d: ISODate): ISODate => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
