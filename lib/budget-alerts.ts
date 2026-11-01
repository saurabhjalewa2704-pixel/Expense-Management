// PRD §6.13 BUD-10: which budget alerts are due. Pure: the caller supplies the view, what was already sent this month, and the owner's choices.
import type { BudgetView, LimitView } from "@/lib/budget";
import { dayOfMonth, type ISODate } from "@/lib/dates";
import { formatGBP, type Pence } from "@/lib/money";

export type AlertKind = "forecast_over" | "pct80" | "reached";
export interface AlertPrefs { forecast: boolean; pct80: boolean; reached: boolean }
export interface SentAlert { category_id: string | null; kind: AlertKind; last_value_pence: Pence | null }
export interface DueAlert { kind: AlertKind; categoryId: string | null; name: string; value: Pence; title: string; body: string; url: string }

const whole = (p: Pence) => formatGBP(p, { whole: true });

/** Forecast to go over: from day 7, more than 5% and more than £10 over the limit. */
export const forecastOver = (l: LimitView, dom: number) =>
  dom >= 7 && l.forecast.available && !l.forecast.closed && l.variance > Math.max(1000, Math.floor(l.amount / 20));

/**
 * At most one alert per limit, per kind, per month. A forecast_over alert may come again only if the forecast overspend has grown by
 * 50% or more since the one that was sent (EC-G14), so a forecast crossing the line back and forth does not repeat itself.
 */
export function dueAlerts(v: BudgetView, sent: readonly SentAlert[], prefs: AlertPrefs, today: ISODate): DueAlert[] {
  if (v.closed) return [];
  const dom = dayOfMonth(today);
  const out: DueAlert[] = [];
  const done = (cat: string | null, kind: AlertKind) => sent.find((s) => s.category_id === cat && s.kind === kind);
  for (const l of [v.overall, ...v.limits]) {
    const cat = l.categoryId;
    const label = l.kind === "overall" ? "Your monthly budget" : `${l.name}`;
    const url = cat ? `/analytics/category/${cat}` : "/budget";
    if (prefs.reached && l.spent >= l.amount && !done(cat, "reached")) {
      out.push({ kind: "reached", categoryId: cat, name: l.name, value: l.spent, title: `${label} limit reached`.replace("Your monthly budget limit", "Monthly budget"), body: `${whole(l.spent)} spent of ${whole(l.amount)}.`, url });
    } else if (prefs.pct80 && l.spent * 100 >= l.amount * 80 && l.spent < l.amount && !done(cat, "pct80")) {
      out.push({ kind: "pct80", categoryId: cat, name: l.name, value: l.spent, title: `${label}: 80% used`, body: `${whole(l.spent)} of ${whole(l.amount)} with ${l.forecast.daysLeft} ${l.forecast.daysLeft === 1 ? "day" : "days"} left.`, url });
    }
    if (prefs.forecast && forecastOver(l, dom)) {
      const prev = done(cat, "forecast_over");
      if (!prev || (prev.last_value_pence !== null && l.variance * 2 >= prev.last_value_pence * 3)) {
        out.push({ kind: "forecast_over", categoryId: cat, name: l.name, value: l.variance, title: `${label} is heading ${whole(l.variance)} over`, body: `Forecast ${whole(l.forecast.forecast)} against ${whole(l.amount)}. ${whole(Math.max(0, l.left - l.billsToCome))} left to spend over ${l.forecast.daysLeft} days.`, url });
      }
    }
  }
  return out;
}
