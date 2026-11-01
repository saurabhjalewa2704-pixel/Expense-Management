import { NextResponse, type NextRequest } from "next/server";
import { isISODate, monthStart, todayLondon } from "@/lib/dates";
import { loadMonthForecast } from "@/lib/forecast-data";
import { supabaseServer } from "@/lib/supabase/server";

// PRD §6.13 BUD-05a rule 9: every input and intermediate value of the forecast, as JSON, so any figure can be audited.
// Requires the signed-in owner. Disabled in production unless DEBUG_FORECAST=1. `?today=YYYY-MM-DD` replaces the clock in test mode only.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_FORECAST !== "1" && !process.env.STERLING_TEST_TODAY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const raw = p.get("month");
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw && isISODate(raw) ? monthStart(raw) : monthStart(todayLondon());
  const pinned = process.env.STERLING_TEST_TODAY;
  const override = pinned ? (p.get("today") ?? pinned) : null;
  const today = override && isISODate(override) ? override : todayLondon();
  const category = p.get("category");
  try {
    const r = await loadMonthForecast(supabase, month, today, category || null);
    return NextResponse.json({ month, today, ...r }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the forecast" }, { status: 500 });
  }
}
