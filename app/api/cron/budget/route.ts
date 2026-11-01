import { NextResponse, type NextRequest } from "next/server";
import { runBudgetAlerts } from "@/lib/budget-alerts-server";
import { serverToday } from "@/lib/ai/server";
import { cronSecret } from "@/lib/env";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** BUD-10 / BUD-11: each morning, the budget alerts that are due and the night's forecast snapshot. Idempotent: one alert per kind, limit and month. */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = supabaseService();
  const today = serverToday();
  const { data: users } = await db.from("budgets").select("user_id").is("category_id", null);
  const ids = [...new Set((users ?? []).map((u) => (u as { user_id: string }).user_id))];
  const out: { user: string; sent?: number; snapshot?: boolean; error?: string }[] = [];
  for (const id of ids) {
    try { const r = await runBudgetAlerts(db, id, today, { snapshot: true }); out.push({ user: id, sent: r.sent.length, snapshot: r.snapshot }); }
    catch (e) { console.error("[cron/budget]", e); out.push({ user: id, error: String(e) }); }
  }
  return NextResponse.json({ today, results: out });
}
