// §6.14.16: the sentences behind "Why this forecast?", built only from the Forecast's own numbers.
import { formatDayMonth, formatMonthShort } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { posBucket } from "./prior";
import type { CoreResult } from "./engine";
import type { ForecastInput, ISO } from "./types";

const gbp = (p: number) => formatGBP(p);
const range = (a: ISO, b: ISO) => (a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${formatDayMonth(b)}` : `${formatDayMonth(a)} – ${formatDayMonth(b)}`);

export function explain(inp: ForecastInput, c: CoreResult): { sentences: string[]; nextSwitch: string[]; weekday: number[] | null; position: number[] | null } {
  const out: string[] = [], next: string[] = [];
  const pr = c.prior;
  if (pr.mu !== null && pr.histFrom && pr.histTo) {
    out.push(`${gbp(Math.round(pr.mu.toNumber()))} a day, from ${pr.H} tracked days (${range(pr.histFrom, pr.histTo)}). Recent days count more.`);
  } else out.push(c.regime === "this-month-only" ? "No usable history yet, so this month’s own pace is used." : "No history yet.");
  const dow = pr.dowOn ? pr.dow.map((x) => x.toNumber()) : null;
  if (dow) {
    const weekend = (dow[5]! + dow[6]!) / 2, weekday = (dow[0]! + dow[1]! + dow[2]! + dow[3]! + dow[4]!) / 5;
    const ratio = weekend / weekday;
    if (ratio >= 1.15) out.push(`Weekends usually ${ratio.toFixed(1)}× weekdays`);
    else if (ratio <= 0.87) out.push(`Weekdays usually ${(1 / ratio).toFixed(1)}× weekends`);
  }
  const pos = pr.posOn ? pr.pos.map((x) => x.toNumber()) : null;
  if (pos) {
    const names = ["The first third of the month", "The middle third of the month", "The last third of the month"];
    const b = [0, 1, 2].reduce((m, i) => (Math.abs(pos[i]! - 1) > Math.abs(pos[m]! - 1) ? i : m), 0);
    const pct = Math.round(Math.abs(pos[b]! - 1) * 100);
    if (pct >= 5) out.push(`${names[b]} runs ${pct}% ${pos[b]! > 1 ? "higher" : "lower"}`);
  }
  if (c.n === 0) out.push("No full days yet");
  else if (c.R !== null) {
    const pct = Math.round((c.R.toNumber() - 1) * 100);
    out.push(pct === 0 ? `Running at your usual over ${c.n} ${c.n === 1 ? "day" : "days"}` : `Running ${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} usual over ${c.n} ${c.n === 1 ? "day" : "days"}`);
  }
  out.push(`Weight on this month: ${Math.round(c.w.toNumber() * 100)}%`);
  if (!pr.dowOn) next.push(`Weekday patterns switch on after 21 tracked days (${Math.max(0, 21 - pr.H)} to go)`);
  if (!pr.posOn) next.push("The payday pattern switches on once each third of the month has two months of data");
  next.push("Accuracy checks start after 2 full months.");
  if (pr.season === null) next.push("Seasonal patterns switch on after 13 months");
  const ch = inp.params_changed;
  if (ch && inp.today >= ch.on) {
    const d = (Date.parse(inp.today) - Date.parse(ch.on)) / 86400000;
    if (d <= 30) out.push(`Model updated on ${formatDayMonth(ch.on)}: now uses a ${ch.half_life}-day half-life and k = ${ch.k}`);
  }
  void formatMonthShort; void posBucket;
  return { sentences: out, nextSwitch: next, weekday: dow, position: pos };
}
