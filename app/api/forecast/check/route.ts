import { NextResponse } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { runNightly } from "@/lib/forecast/backtest-server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Check accuracy now" (§6.14.19 step 5): the backtest for the last three complete months, run as the signed-in user, so accuracy exists from day one. */
export async function POST() {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try { return NextResponse.json(await runNightly(db, auth.user.id, serverToday(), 3)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not run the check" }, { status: 500 }); }
}
