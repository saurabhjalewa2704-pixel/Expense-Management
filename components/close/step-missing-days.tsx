"use client";
// Step 1 · Missing days (MC03, §5).
import { useState } from "react";
import { useQuickAdd } from "@/components/capture/quick-add";
import { dayContext, groupRuns, monthName, notLoggingForAWhile, type DayItem } from "@/lib/close/logic";
import { monthFromParam } from "@/lib/close/logic";
import { monthStart, type ISODate } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { useMonthForecast, useOutbox } from "@/lib/queries/hooks";
import { CloseGate, CloseShell, StepHead, Tick, useCloseFlow } from "./common";

const longDay = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function StepMissingDays({ param }: { param: string }) {
  const month = monthFromParam(param);
  if (!month) return null;
  return <CloseGate month={month}>{() => <Body month={month} />}</CloseGate>;
}

function Body({ month }: { month: ISODate }) {
  const f = useCloseFlow(month);
  const { open } = useQuickAdd();
  const outbox = useOutbox();
  const fc = useMonthForecast(monthStart(f.today));
  const usual = fc.data?.forecast.prior.usualPerDay ?? null;
  const weekday = fc.data?.forecast.prior.weekdayProfile ? fc.data.forecast.detail.weekdayMultipliers : null;
  const [expanded, setExpanded] = useState<Set<ISODate>>(new Set());
  const [more, setMore] = useState<ISODate | null>(null);
  const pendingDates = new Set(outbox.filter((o) => o.status === "pending").map((o) => o.payload.occurred_on as ISODate));
  const days = (f.checks.data!.missing_days ?? []).filter((d) => d.answer || !pendingDates.has(d.day));      // MC-08: saved offline counts at once
  const items = groupRuns(days, expanded);
  const openCount = days.filter((d) => !d.answer).length;
  const answered = days.length - openCount;
  const banner = notLoggingForAWhile(days);
  const title = days.length === 0 ? "Every day has something logged" : openCount === 0 ? `${days.length} ${days.length === 1 ? "day" : "days"} answered` : `${openCount} ${openCount === 1 ? "day" : "days"} with nothing logged`;

  const runBtns = (it: Extract<DayItem, { kind: "run" }>) => (
    <div className="mc-acts">
      <button className="mc-act" data-testid="run-none" onClick={() => void f.actions.answerDays(it.days, "no_spend")}><UI.Check size={16} aria-hidden />None of these, nothing spent</button>
      <button className="mc-act" data-testid="run-not-tracked" onClick={() => void f.actions.answerDays(it.days, "not_tracked")}>I wasn’t tracking</button>
      <button className="mc-act ghost" onClick={() => setExpanded((s) => new Set([...s, ...it.days]))}>Pick days</button>
    </div>
  );

  return (
    <CloseShell month={month} index={1} back={() => f.go("overview")}
      hint={days.length ? `${answered} of ${days.length} answered` : undefined}
      footer={<button className="btn" data-testid="close-continue" onClick={() => void f.finishStep("missing_days")}>Continue</button>}>
      <StepHead step="Step 1 · Missing days" title={title}
        lead={days.length ? "If you really spent nothing, say so. That keeps these days in your “usual” instead of being treated as a gap." : `Nothing to check in ${monthName(month)}.`} />
      {banner && (
        <div className="mc-item" data-testid="not-logging-banner">
          <div className="hd"><div className="tile"><UI.Info size={20} aria-hidden /></div><div className="ti"><b>Looks like you weren’t logging for a while</b><span>More than 15 days have nothing logged.</span></div></div>
          <div className="mc-acts"><button className="mc-act" data-testid="mark-all-not-tracked" onClick={() => void f.actions.answerDays(days.filter((d) => !d.answer).map((d) => d.day), "not_tracked")}>Mark all as not tracked</button></div>
        </div>
      )}
      {items.map((it) => it.kind === "run" ? (
        <div className="mc-item" key={it.from} data-testid="missing-run">
          <div className="hd"><div className="tile"><UI.Calendar size={20} aria-hidden /></div><div className="ti"><b>{shortDay(it.from)}–{shortDay(it.to)} · {it.days.length} days</b><span>Nothing logged on any of these days</span></div></div>
          {runBtns(it)}
        </div>
      ) : (
        <div className="mc-item" key={it.day} data-testid="missing-day" data-day={it.day}>
          <div className="hd"><div className="tile"><UI.Calendar size={20} aria-hidden /></div><div className="ti"><b>{longDay(it.day)}</b><span>{dayContext(it.day, usual, weekday)}</span></div></div>
          <div className="mc-acts">
            <button className={`mc-act ${it.answer === "no_spend" ? "on" : ""}`} data-testid="day-no-spend" onClick={() => void f.actions.answerDay(it.day, it.answer === "no_spend" ? "reset" : "no_spend")}><UI.Check size={16} aria-hidden />Nothing to log</button>
            <button className="mc-act" data-testid="day-add" onClick={() => open({ date: it.day, mode: "expense" })}><UI.Plus size={16} aria-hidden />Add expense</button>
            {it.answer !== "not_tracked" && <button className="mc-act ghost" onClick={() => setMore(more === it.day ? null : it.day)}>More</button>}
          </div>
          {more === it.day && <div className="mc-acts" style={{ marginTop: 8 }}><button className="mc-act" data-testid="day-not-tracked" onClick={() => { setMore(null); void f.actions.answerDay(it.day, "not_tracked"); }}>I didn’t log, can’t remember</button></div>}
          {it.answer === "no_spend" && <Tick>Marked as a no-spend day</Tick>}
          {it.answer === "not_tracked" && <><Tick>Marked as not tracked, so it stays out of your “usual”</Tick><div className="mc-acts" style={{ marginTop: 4 }}><button className="mc-act ghost" onClick={() => void f.actions.answerDay(it.day, "reset")}>Undo</button></div></>}
        </div>
      ))}
      {days.length > 0 && <p className="mc-note">“Add expense” opens Quick Add with the date already set. Bills logged automatically don’t count as logging, so a day with only a bill still shows here.</p>}
    </CloseShell>
  );
}
