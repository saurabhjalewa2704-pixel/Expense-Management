import "server-only";
import { addDays, type ISODate } from "@/lib/dates";
import { gbpPerUnit, parseFallbackRate, rateString, scaleRate } from "@/lib/fx";

const BASE = "https://api.frankfurter.dev/v1";

/** Tests only: STERLING_FX_STUB="USD=0.79,EUR=0.86" gives a fixed GBP-per-unit rate for any date, with no network. */
export function stubRate(currency: string): string | null {
  const s = process.env.STERLING_FX_STUB;
  if (!s) return null;
  const hit = s.split(",").map((p) => p.trim().split("=")).find(([c]) => c?.toUpperCase() === currency.toUpperCase());
  return hit?.[1] ? rateString(scaleRate(hit[1])) : null;
}

export interface RatePoint { on: ISODate; gbp_per_unit: string }

/**
 * Frankfurter publishes the ECB's reference rates, which leave out many currencies a trip can be in (the Moroccan dirham, for one), so
 * for those the day's rate comes from a second source with a mirror. Its date can be one day earlier than asked for; the caller records it.
 */
async function fallbackRate(currency: string, date: ISODate): Promise<RatePoint | null> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/gbp.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/gbp.json`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const hit = parseFallbackRate(await r.json(), currency);
      if (hit) return { on: hit.on, gbp_per_unit: hit.gbp_per_unit };
    } catch { /* try the mirror */ }
  }
  return null;
}

/** The reference rate for one day (the latest working day on or before it). Frankfurter publishes ECB rates, history included. */
export async function liveRate(currency: string, date: ISODate): Promise<RatePoint | null> {
  const stub = stubRate(currency);
  if (stub) return { on: date, gbp_per_unit: stub };
  try {
    const r = await fetch(`${BASE}/${date}?base=GBP&symbols=${currency}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { date: string; rates: Record<string, number> };
      const perGbp = j.rates?.[currency];
      if (perGbp) return { on: j.date, gbp_per_unit: gbpPerUnit(perGbp) };
    }
  } catch { /* fall through to the second source */ }
  return fallbackRate(currency, date);
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
    if (r.ok) {
      const j = (await r.json()) as { rates: Record<string, Record<string, number>> };
      const points = Object.entries(j.rates ?? {}).filter(([, v]) => v[currency]).map(([on, v]) => ({ on, gbp_per_unit: gbpPerUnit(v[currency]!) }));
      if (points.length) return points;
    }
  } catch { /* fall through to the second source */ }
  // not an ECB currency: one snapshot per day, a few at a time, skipping days the source does not have
  const days: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const out: RatePoint[] = [];
  for (let i = 0; i < days.length; i += 6) {
    const got = await Promise.all(days.slice(i, i + 6).map((d) => fallbackRate(currency, d)));
    for (const [k, p] of got.entries()) if (p && p.on === days[i + k]) out.push(p);
  }
  return out;
}
