import { NextResponse, type NextRequest } from "next/server";
import { cronSecret } from "@/lib/env";
import { londonParts } from "@/lib/dates";
import { periodFor } from "@/lib/ai/facts";
import { runDigest, serverToday } from "@/lib/ai/server";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Weekly (Monday) and monthly (1st) digests (AI-01). Vercel cron is UTC-only, so it fires daily at 07:00 UTC, which is 07:00
 * London in winter and 08:00 in summer; the handler acts on a Monday or the 1st once it is 07:00 or later in London.
 * Idempotent per scope and period, so a retry or an extra call is harmless. `?scope=weekly|monthly` forces a run.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const now = londonParts();
  const forced = req.nextUrl.searchParams.get("scope");
  const scopes: ("weekly" | "monthly")[] = forced === "weekly" || forced === "monthly" ? [forced] : [];
  if (!forced && now.hour >= 7) {
    if (now.weekday === 0) scopes.push("weekly");
    if (now.date.endsWith("-01")) scopes.push("monthly");
  }
  const db = supabaseService();
  const { data: users } = await db.from("profiles").select("id, ai_include_notes").eq("ai_enabled", true);
  const ran: { user: string; scope: string; run?: string; skipped?: string; error?: string }[] = [];
  for (const u of (users ?? []) as { id: string; ai_include_notes: boolean }[]) {
    for (const scope of scopes) {
      const today = serverToday();
      const { period } = periodFor(scope, today);
      const { data: existing } = await db.from("insight_runs").select("id").eq("user_id", u.id).eq("scope", scope).eq("period_start", period.from).limit(1);
      if (existing?.length) { ran.push({ user: u.id, scope, skipped: "already generated" }); continue; }
      try {
        const run = await runDigest(db, u.id, scope, { includeNotes: u.ai_include_notes, today });
        ran.push({ user: u.id, scope, run: run.id });
      } catch (e) {
        console.error("[cron/digest]", e);
        ran.push({ user: u.id, scope, error: String(e) });
      }
    }
  }
  return NextResponse.json({ london: now, scopes, ran });
}
