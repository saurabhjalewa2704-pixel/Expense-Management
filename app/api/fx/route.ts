import { NextResponse, type NextRequest } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { diffDays, isISODate, type ISODate } from "@/lib/dates";
import { liveRate, liveSeries, type RatePoint } from "@/lib/fx-rates";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Best-effort write to the shared rate cache. It needs the service role, so it quietly does nothing where that is not configured. */
async function cache(points: { on: ISODate; currency: string; gbp_per_unit: string }[]) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || points.length === 0) return;
  try { await supabaseService().from("fx_rates").upsert(points.map((p) => ({ on_date: p.on, currency: p.currency, gbp_per_unit: p.gbp_per_unit })), { onConflict: "on_date,currency", ignoreDuplicates: true }); } catch { /* the cache is an optimisation */ }
}

/**
 * TRIP-06: a reference rate in GBP per unit. `?currency=USD&date=2027-03-12` for one day (the latest earlier rate on weekends and holidays),
 * `?currency=USD&from=…&to=…` for a run of days (the phone keeps the last 30 for offline entry). Served from the cache when it is fresh, else live.
 */
export async function GET(req: NextRequest) {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const currency = (q.get("currency") ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "GBP") return NextResponse.json({ error: "Unknown currency" }, { status: 400 });
  const today = serverToday();

  const from = q.get("from"), to = q.get("to");
  if (from && to) {
    if (!isISODate(from) || !isISODate(to) || from > to || diffDays(to, from) > 400) return NextResponse.json({ error: "Bad range" }, { status: 400 });
    const { data } = await db.from("fx_rates").select("on_date, gbp_per_unit").eq("currency", currency).gte("on_date", from).lte("on_date", to).order("on_date");
    let points: RatePoint[] = ((data ?? []) as { on_date: string; gbp_per_unit: number | string }[]).map((r) => ({ on: r.on_date, gbp_per_unit: String(r.gbp_per_unit) }));
    if (points.length < Math.min(diffDays(to, from) / 2, 10)) {
      points = await liveSeries(currency, from, to);
      void cache(points.map((p) => ({ ...p, currency })));
    }
    return NextResponse.json({ currency, rates: points });
  }

  let date = (q.get("date") ?? today) as ISODate;
  if (!isISODate(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });
  if (date > today) date = today;                                   // there is no rate for tomorrow
  const { data: hit } = await db.from("fx_rates").select("on_date, gbp_per_unit").eq("currency", currency).lte("on_date", date).order("on_date", { ascending: false }).limit(1);
  const cached = ((hit ?? []) as { on_date: string; gbp_per_unit: number | string }[])[0];
  if (cached && diffDays(date, cached.on_date) <= 4) return NextResponse.json({ currency, rate: String(cached.gbp_per_unit), on: cached.on_date, source: "cache" });
  const live = await liveRate(currency, date);
  if (live) {
    void cache([{ ...live, currency }, ...(live.on !== date ? [{ on: date, currency, gbp_per_unit: live.gbp_per_unit }] : [])]);
    return NextResponse.json({ currency, rate: live.gbp_per_unit, on: live.on, source: "live" });
  }
  if (cached) return NextResponse.json({ currency, rate: String(cached.gbp_per_unit), on: cached.on_date, source: "stale" });
  return NextResponse.json({ error: "No rate available", currency }, { status: 404 });
}

