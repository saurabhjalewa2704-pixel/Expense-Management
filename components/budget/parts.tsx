"use client";
// Shared pieces of the Budget screens (PRD §6.13): status pill, the overall meter, and one limit row.
import Link from "next/link";
import type { ReactNode } from "react";
import type { LimitView } from "@/lib/budget";
import type { BudgetStatus } from "@/lib/forecast";
import { CategoryIcon } from "@/lib/icons";
import { formatGBP } from "@/lib/money";

const whole = (p: number) => formatGBP(p, { whole: true });

export const STATUS_LABEL: Record<BudgetStatus, string> = { early: "Early days", on_track: "On track", tight: "Tight", over: "Over" };
export const STATUS_CLASS: Record<BudgetStatus, string> = { early: "", on_track: "pos", tight: "cau", over: "over" };

export function StatusPill({ status }: { status: BudgetStatus }) {
  return <span className={`pill ${STATUS_CLASS[status]}`} data-testid="budget-status">{STATUS_LABEL[status]}</span>;
}

/** Spent (solid), bills still to come (hatched), the rest of the forecast (outlined), the plan-by-today tick and the budget tick. */
export function BudgetMeter({ v }: { v: LimitView }) {
  const f = v.forecast;
  const scale = Math.max(v.amount, f.forecast, v.spent, 1) * 1.04;
  const w = (p: number) => `${Math.max(0, Math.min(100, (p / scale) * 100))}%`;
  const spent = Math.max(0, v.spent);
  const bills = Math.min(f.billsToCome, Math.max(0, f.forecast - spent));
  const rest = Math.max(0, f.forecast - spent - bills);
  return (
    <>
      <div className="meter" role="img" aria-label={`Spent ${whole(spent)} of ${whole(v.amount)}; plan by today ${whole(v.plan)}`}>
        <span className="seg ms" style={{ left: 0, width: w(spent) }} />
        {f.available && !f.closed && <span className="seg mc" style={{ left: w(spent), width: w(bills) }} />}
        {f.available && !f.closed && <span className="seg mf" style={{ left: w(spent + bills), width: w(rest) }} />}
        <span className="mk plan" style={{ left: w(v.plan) }} />
        <span className="mk" style={{ left: w(v.amount) }} />
      </div>
      <div className="meter-lab"><span>Spent</span><span style={{ color: "var(--positive)" }}>Plan by today</span><span>Budget</span></div>
    </>
  );
}

/** The wording under a limit's name, right-hand side: "Forecast £142 over" / "Forecast £38 under" / "Forecast after 3 days". */
export function forecastWords(v: LimitView): { text: string; tone: "cau" | "pos" | "" } {
  const f = v.forecast;
  if (f.closed) return v.spent > v.amount ? { text: `Ended ${whole(v.spent - v.amount)} over`, tone: "cau" } : { text: `Ended ${whole(v.amount - v.spent)} under`, tone: "pos" };
  if (!f.available) return { text: "Forecast after 3 days", tone: "" };
  const d = v.variance;
  return d > 0 ? { text: `Forecast ${whole(d)} over`, tone: "cau" } : { text: `Forecast ${whole(-d)} under`, tone: "pos" };
}

const TONE: Record<string, string> = { cau: "var(--caution)", pos: "var(--positive)", "": "var(--ink-3)" };

/** One limit: icon, name, spent / limit, a bar with the forecast outline and the limit tick, and the left / per-day caption. */
export function LimitRow({ v, href, onClick, children }: { v: LimitView; href?: string; onClick?: () => void; children?: ReactNode }) {
  const f = v.forecast;
  const scale = Math.max(v.amount, f.forecast, v.spent, 1) / 0.98;
  const pct = (p: number) => `${Math.max(0, Math.min(100, (p / scale) * 100))}%`;
  const over = v.spent > v.amount || (f.available && v.variance > 0);
  const fw = forecastWords(v);
  const spent = Math.max(0, v.spent);
  const fwidth = f.available && !f.closed ? Math.max(0, f.forecast - spent) : 0;
  // what is left after the bills still to come, spread over the days left (mock-up 26: Entertainment £2.86/day)
  const free = v.left - v.billsToCome;
  const perDay = f.available && !f.closed && free > 0 && f.daysLeft > 0 ? Math.floor(free / f.daysLeft) : null;
  const elsewhere = v.kind === "elsewhere";
  const body = (
    <>
      <div className="tile">{v.icon ? <CategoryIcon name={v.icon} size={16} /> : <span aria-hidden style={{ letterSpacing: 2 }}>···</span>}</div>
      <div className="n" style={elsewhere ? { color: "var(--ink-2)" } : undefined}>{v.name}</div>
      <div className="r">{formatGBP(v.spentShown)}<span style={{ color: "var(--ink-3)", fontWeight: 400 }}> / {whole(v.amount)}</span></div>
      {!elsewhere && (
        <div className="bar" aria-hidden>
          <span className="s" style={{ width: pct(spent), background: over ? "var(--caution)" : "var(--ink)" }} />
          {fwidth > 0 && <span className="f" style={{ left: pct(spent), width: pct(fwidth) }} />}
          <span className="end" style={{ left: pct(v.amount) }} />
        </div>
      )}
      <div className="cap" style={elsewhere ? { marginTop: 0 } : undefined}>
        <span>
          {elsewhere && v.amount === 0 ? "No allowance left after your limits"
            : elsewhere ? "No limits set"
            : v.netRefund ? "Net refund this month"
            : v.left < 0 ? `${whole(-v.left)} over`
            : `${formatGBP(v.left)} left${perDay !== null ? ` · ${formatGBP(perDay)}/day` : ""}`}
        </span>
        <span className="w" style={{ color: TONE[fw.tone] }}>{fw.text}</span>
      </div>
      {children}
    </>
  );
  return href ? <Link href={href} className="cb" data-testid="limit-row" data-limit={v.name}>{body}</Link>
    : onClick ? <button className="cb" style={{ width: "100%", textAlign: "left" }} onClick={onClick} data-testid="limit-row" data-limit={v.name}>{body}</button>
    : <div className="cb" data-testid="limit-row" data-limit={v.name}>{body}</div>;
}
