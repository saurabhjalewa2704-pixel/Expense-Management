import { NextResponse, type NextRequest } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { runNightly } from "@/lib/forecast/backtest-server";
import { cronSecret } from "@/lib/env";
import { supabaseAsUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** FORECASTING-ENGINE-PRD §6.14.13: the nightly backtest, tuning and snapshot. Idempotent; `?once=1` is the first run after deploy. */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = supabaseService();
  const today = serverToday();
  const { data: users } = await db.from("profiles").select("id").not("onboarded_at", "is", null);
  const out: { user: string; months?: number; rows?: number; tuned?: boolean; error?: string }[] = [];
  for (const u of (users ?? []) as { id: string }[]) {
    try { const r = await runNightly(await supabaseAsUser(u.id), u.id, today); out.push({ user: u.id, ...r }); }
    catch (e) { console.error("[cron/forecast]", e); out.push({ user: u.id, error: String(e) }); }
  }
  return NextResponse.json({ today, results: out });
}
