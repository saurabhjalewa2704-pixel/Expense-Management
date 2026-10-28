import "server-only";
import { addDays, type ISODate } from "@/lib/dates";
import { gbpPerUnit, rateString, scaleRate } from "@/lib/fx";

const BASE = "https://api.frankfurter.dev/v1";

/** Tests only: STERLING_FX_STUB="USD=0.79,EUR=0.86" gives a fixed GBP-per-unit rate for any date, with no network. */
export function stubRate(currency: string): string | null {
  const s = process.env.STERLING_FX_STUB;
  if (!s) return null;
  const hit = s.split(",").map((p) => p.trim().split("=")).find(([c]) => c?.toUpperCase() === currency.toUpperCase());
  return hit?.[1] ? rateString(scaleRate(hit[1])) : null;
}

export interface RatePoint { on: ISODate; gbp_per_unit: string }

/** The reference rate for one day (the latest working day on or before it). Frankfurter publishes ECB rates, history included. */
export async function liveRate(currency: string, date: ISODate): Promise<RatePoint | null> {
  const stub = stubRate(currency);
  if (stub) return { on: date, gbp_per_unit: stub };
  try {
    const r = await fetch(`${BASE}/${date}?base=GBP&symbols=${currency}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { date: string; rates: Record<string, number> };
    const perGbp = j.rates?.[currency];
    return perGbp ? { on: j.date, gbp_per_unit: gbpPerUnit(perGbp) } : null;
  } catch { return null; }
}

/** A run of days, for the daily cache and the 30 days the phone keeps for offline use. */
export async function liveSeries(currency: string, from: ISODate, to: ISODate): Promise<RatePoint[]> {
  const stub = stubRate(currency);
  if (stub) {
    const out: RatePoint[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ on: d, gbp_per_unit: stub });
    return out;
  }
  try {
    const r = await fetch(`${BASE}/${from}..${to}?base=GBP&symbols=${currency}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { rates: Record<string, Record<string, number>> };
    return Object.entries(j.rates ?? {}).filter(([, v]) => v[currency]).map(([on, v]) => ({ on, gbp_per_unit: gbpPerUnit(v[currency]!) }));
  } catch { return []; }
}
