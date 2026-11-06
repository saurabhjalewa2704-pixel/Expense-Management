"use client";
// MC01 / MC11: the month-close card on Home. Ready, in progress, several months, first (partial) month, or the slim row after 14 days.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCloseChecks, useCloseState } from "@/lib/close/data";
import { balancesShown, cardMode, closeUrl, estimateMinutes, firstUnfinishedStep, laterUntilMs, monthName, monthsToClose, stepCounts, stepStatus, waitingLine } from "@/lib/close/logic";
import { STEPS, isClosed } from "@/lib/close/types";
import { UI } from "@/lib/icons";
import { useNow, useProfile, useToday } from "@/lib/queries/hooks";

const KEY = "sterling-close-later";
const readLater = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>; } catch { return {}; } };

export function CloseCard() {
  const today = useToday();
  const now = useNow();
  const state = useCloseState();
  const { data: profile } = useProfile();
  const months = monthsToClose(state.data);
  const oldest = months[0];
  const checks = useCloseChecks(oldest?.month ?? "2000-01-01", !!oldest);
  const [later, setLater] = useState<Record<string, number>>({});
  useEffect(() => setLater(readLater()), []);
  if (!oldest) return null;
  const mode = cardMode(oldest, today, later[oldest.month] ?? null, now);
  if (mode === "hidden") return null;
  const name = monthName(oldest.month);
  const c = checks.data;
  const counts = c ? stepCounts(c, profile?.close_check_savings ?? false) : null;
  const minutes = counts && c ? estimateMinutes({ missing: counts.missing_days.open, bills: counts.bills.open, tidy: counts.tidy_up.open, accounts: balancesShown(c.balances, profile?.close_check_savings ?? false).length }) : 2;
  const dismiss = () => { const next = { ...later, [oldest.month]: laterUntilMs(today) }; setLater(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: it just returns on reload */ } };
  const many = months.length > 1;
  const href = closeUrl(oldest.month);

  if (mode === "slim") {
    return <Link href={href} className="mc-slim" data-testid="close-card" data-mode="slim"><UI.CircleCheck size={18} aria-hidden /><span>{many ? `${months.length} months to close` : `${name} is still open`}</span><em>Start</em><UI.ChevronRight size={16} className="chev" aria-hidden /></Link>;
  }
  if (mode === "in_progress" && counts) {
    const done = STEPS.filter((s) => ["done", "nothing"].includes(stepStatus(s.key, oldest.step_state, counts).kind)).length;
    const stopped = firstUnfinishedStep(oldest.step_state, counts);
    return (
      <div className="mc-card" data-testid="close-card" data-mode="in_progress">
        <div className="row-between"><span className="eyebrow"><UI.CircleCheck size={14} aria-hidden />Month close</span></div>
        <h3>Finish closing {name}</h3>
        <p>{done} of 6 steps done.{stopped ? ` You stopped at ${STEPS.find((s) => s.key === stopped)!.title.replace("{next}", monthName(oldest.month))}.` : ""}</p>
        <div className="mcd" aria-hidden>{STEPS.map((s, i) => <i key={s.key} className={i < done ? "d" : ""} />)}</div>
        <div className="acts"><Link href={`${href}?resume=1`} className="go" data-testid="close-continue-card">Continue <UI.ChevronRight size={16} aria-hidden /></Link></div>
      </div>
    );
  }
  const partial = oldest.partial && profile?.tracking_started_on;
  const days = partial && profile?.tracking_started_on ? Math.round((Date.parse(`${oldest.month.slice(0, 8)}01T00:00:00Z`) - 0) / 86400000) : 0;
  void days;
  const startedOn = profile?.tracking_started_on ? new Date(`${profile.tracking_started_on}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
  const coversDays = c ? c.to.slice(8) && Number(c.to.slice(8)) - Number(c.from.slice(8)) + 1 : null;
  return (
    <div className="mc-card" data-testid="close-card" data-mode="ready">
      <div className="row-between"><span className="eyebrow"><UI.CircleCheck size={14} aria-hidden />Month close</span><span className="sub" data-testid="close-card-time">About {minutes} min</span></div>
      <h3>{many ? `${months.length} months to close` : `${name} is ready to close`}</h3>
      <p data-testid="close-card-line">
        {many ? `Months close oldest first, starting with ${name}.` : partial && startedOn && coversDays ? `Tracked from ${startedOn}, so this one covers ${coversDays} days.` : counts ? `6 quick checks so your numbers stay right: ${waitingLine(counts)}.` : "6 quick checks so your numbers stay right."}
      </p>
      <div className="acts">
        <Link href={href} className="go" data-testid="close-start-card">{many ? `Close ${name}` : "Start"} <UI.ChevronRight size={16} aria-hidden /></Link>
        <button className="later" data-testid="close-later" onClick={dismiss}>Later</button>
      </div>
    </div>
  );
}
