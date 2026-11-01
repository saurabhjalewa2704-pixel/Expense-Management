import { NextResponse } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { runBudgetAlerts } from "@/lib/budget-alerts-server";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** BUD-10 "after writes": the app calls this once new entries have reached the server. It runs as the signed-in user, so only their rows are read. */
export async function POST() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const r = await runBudgetAlerts(supabase, auth.user.id, serverToday(), { push: supabaseService() });
    return NextResponse.json({ sent: r.sent.map((a) => ({ kind: a.kind, name: a.name })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not check budgets" }, { status: 500 });
  }
}
