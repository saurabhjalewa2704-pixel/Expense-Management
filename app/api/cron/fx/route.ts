import { NextResponse, type NextRequest } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { addDays } from "@/lib/dates";
import { liveSeries } from "@/lib/fx-rates";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TRIP-06: once a day, fetch the last 30 days of reference rates (Frankfurter, ECB) for the currencies of trips that are on or still to come,
 * and cache them in `fx_rates`. Idempotent. The app also fetches on demand (`/api/fx`), so a missed run only means a slower first entry.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set in this deployment's environment variables." }, { status: 500 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in this deployment's environment variables." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const today = serverToday();
  const db = supabaseService();
  const [{ data: trips }, { data: stops }] = await Promise.all([
    db.from("trips").select("currency").gte("end_on", addDays(today, -2)),
    db.from("trip_stops").select("currency, trip_id").not("currency", "is", null),
  ]);
  const wanted = new Set<string>([...(trips ?? []).map((t: { currency: string }) => t.currency), ...(stops ?? []).map((s: { currency: string | null }) => s.currency ?? "")].filter((c) => c && c !== "GBP"));
  let rows = 0;
  for (const currency of wanted) {
    const points = await liveSeries(currency, addDays(today, -30), today);
    if (!points.length) continue;
    const { error } = await db.from("fx_rates").upsert(points.map((p) => ({ on_date: p.on, currency, gbp_per_unit: p.gbp_per_unit })), { onConflict: "on_date,currency" });
    if (!error) rows += points.length;
  }
  return NextResponse.json({ currencies: [...wanted], rows });
}
