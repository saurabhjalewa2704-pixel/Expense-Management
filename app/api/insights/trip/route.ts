import { NextResponse, type NextRequest } from "next/server";
import { ensureTripInsights } from "@/lib/ai/trip-server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TRIP-08: make sure a trip's insights are current. The app calls this when a trip's overview opens; the server decides whether anything
 * is due (a new morning, an edit, the wrap-up) and otherwise returns the latest run. Runs as the signed-in user, so RLS applies.
 */
export async function POST(req: NextRequest) {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const trip = (await req.json().catch(() => ({}))) as { trip?: string };
  if (!trip.trip || !/^[0-9a-f-]{36}$/i.test(trip.trip)) return NextResponse.json({ error: "Which trip?" }, { status: 400 });
  const { data: profile } = await db.from("profiles").select("ai_enabled").eq("id", auth.user.id).single();
  if (profile && (profile as { ai_enabled: boolean }).ai_enabled === false) return NextResponse.json({ run: null, reason: "AI insights are switched off" });
  try {
    const r = await ensureTripInsights(db, auth.user.id, trip.trip);
    return NextResponse.json({ run: r.run, generated: r.generated, reason: r.reason });
  } catch (e) {
    console.error("[insights/trip]", e);
    return NextResponse.json({ error: "We couldn't refresh this trip's insights." }, { status: 500 });
  }
}
