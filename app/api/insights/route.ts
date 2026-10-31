import { NextResponse } from "next/server";
import { explainAiError } from "@/lib/ai/diagnose";
import { ADHOC_PER_DAY, adhocRunsToday, runDigest } from "@/lib/ai/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AI-01: on-demand refresh. Rate-limited to 10 a day (PRD §6.8). Runs as the signed-in user, so RLS applies. */
export async function POST() {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await db.from("profiles").select("ai_enabled, ai_include_notes").eq("id", auth.user.id).single();
  if (profile && (profile as { ai_enabled: boolean }).ai_enabled === false) return NextResponse.json({ error: "AI insights are switched off in Settings." }, { status: 403 });
  if ((await adhocRunsToday(db, auth.user.id)) >= ADHOC_PER_DAY) {
    return NextResponse.json({ error: `You've used today's ${ADHOC_PER_DAY} refreshes. Try again tomorrow.` }, { status: 429 });
  }
  try {
    const run = await runDigest(db, auth.user.id, "adhoc", { includeNotes: !!(profile as { ai_include_notes?: boolean } | null)?.ai_include_notes });
    return NextResponse.json({ run });
  } catch (e) {
    console.error("[insights]", e);
    return NextResponse.json({ error: `We couldn't refresh your insights. ${explainAiError(e)}` }, { status: 500 });
  }
}
