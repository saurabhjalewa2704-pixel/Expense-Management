import { NextResponse, type NextRequest } from "next/server";
import { cronSecret } from "@/lib/env";
import { londonParts } from "@/lib/dates";
import { periodFor } from "@/lib/ai/facts";
import { runDigest, serverToday } from "@/lib/ai/server";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Weekly (Monday 07:00 London) and monthly (1st, 07:00) digests (AI-01). Vercel cron runs in UTC, so schedule this at both
 * 06:00 and 07:00 UTC and let the handler act only when it is 07:00 in London: correct in summer and winter (PRD §9.5).
 * `?scope=weekly|monthly` forces a run. Idempotent: a digest for a period that already has one is skipped.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const now = londonParts();
  const forced = req.nextUrl.searchParams.get("scope");
  const scopes: ("weekly" | "monthly")[] = forced === "weekly" || forced === "monthly" ? [forced] : [];
  if (!forced && now.hour === 7) {
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
