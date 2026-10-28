// TRIP-06 on the phone: reference rates fetched from /api/fx, with the last 30 days kept in localStorage so a trip can be logged offline.
import { addDays, type ISODate } from "@/lib/dates";
import { convertToPence } from "@/lib/fx";
import type { TxnInput } from "@/lib/schemas/transaction";

export interface Rate { rate: string; on: ISODate }
const KEY = (c: string) => `sterling.fx.${c.toUpperCase()}`;
type Store = Record<ISODate, string>;

function read(currency: string): Store {
  try { return JSON.parse(localStorage.getItem(KEY(currency)) ?? "{}") as Store; } catch { return {}; }
}
function write(currency: string, store: Store) {
  try {
    const keep = Object.keys(store).sort().slice(-45);                         // a little over 30 days, weekends included
    localStorage.setItem(KEY(currency), JSON.stringify(Object.fromEntries(keep.map((k) => [k, store[k]!]))));
  } catch { /* storage can be unavailable or full: the cache is an optimisation */ }
}

/** The latest cached rate on or before `date`; failing that, the latest cached rate at all (EC-T9 uses the last cached rate). */
export function cachedRate(currency: string, date: ISODate): Rate | null {
  const store = read(currency);
  const days = Object.keys(store).sort();
  const on = [...days].reverse().find((d) => d <= date) ?? days.at(-1);
  return on ? { rate: store[on]!, on } : null;
}

/** The reference rate for a day. Null when the network or the service is unavailable (the caller falls back to the cache). */
export async function fetchRate(currency: string, date: ISODate, signal?: AbortSignal): Promise<Rate | null> {
  try {
    const r = await fetch(`/api/fx?currency=${encodeURIComponent(currency)}&date=${date}`, { signal, cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { rate?: string; on?: ISODate };
    if (!j.rate || !j.on) return null;
    const store = read(currency); store[j.on] = j.rate; write(currency, store);
    return { rate: j.rate, on: j.on };
  } catch { return null; }
}

/** Keep the last 30 days of a currency for offline entry. */
export async function warmRates(currency: string, today: ISODate): Promise<void> {
  if (currency === "GBP") return;
  try {
    const r = await fetch(`/api/fx?currency=${encodeURIComponent(currency)}&from=${addDays(today, -30)}&to=${today}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { rates?: { on: ISODate; gbp_per_unit: string }[] };
    const store = read(currency);
    for (const p of j.rates ?? []) store[p.on] = p.gbp_per_unit;
    write(currency, store);
  } catch { /* offline */ }
}

/**
 * Called as an offline entry syncs: if a rate for the expense's own date is now available and the £ figure was never edited by hand,
 * recalculate it silently (TRIP-06). Returns the payload unchanged when nothing applies.
 */
export async function recalcIfNewer(p: TxnInput, feeBps: number): Promise<TxnInput> {
  if (!p.original_currency || !p.original_amount_minor || p.fx_source !== "auto" || !p.fx_rate_on) return p;
  // the first request after coming back online can fail on a dead connection: one more try before settling for the cached rate
  const fresh = (await fetchRate(p.original_currency, p.occurred_on)) ?? (await new Promise((r) => setTimeout(r, 700)).then(() => fetchRate(p.original_currency!, p.occurred_on)));
  if (!fresh || fresh.on <= p.fx_rate_on) return p;
  return { ...p, fx_rate: fresh.rate, fx_rate_on: fresh.on, amount_pence: convertToPence(p.original_amount_minor, p.original_currency, fresh.rate, feeBps) };
}
