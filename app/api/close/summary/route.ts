import { NextResponse, type NextRequest } from "next/server";
import { monthFromParam } from "@/lib/close/logic";
import type { CloseSummary } from "@/lib/close/types";
import { monthSummaryFacts, writeMonthSummary } from "@/lib/ai/month-summary";
import { configuredWriter, serverToday } from "@/lib/ai/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** MC-50.3: the review's summary. The page never waits for it; it asks, and inserts the text when it arrives. Null when AI is off or the text fails validation. */
export async function GET(req: NextRequest) {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const month = monthFromParam((req.nextUrl.searchParams.get("month") ?? "").slice(0, 7));
  if (!month) return NextResponse.json({ error: "Bad month" }, { status: 400 });
  const { data: profile } = await db.from("profiles").select("ai_enabled").eq("id", auth.user.id).single();
  if (profile && (profile as { ai_enabled: boolean }).ai_enabled === false) return NextResponse.json({ text: null });
  const { data: row } = await db.from("month_closes").select("summary, status").eq("month", month).maybeSingle();
  if (row && (row as { summary: string | null }).summary) return NextResponse.json({ text: (row as { summary: string }).summary });
  const writer = configuredWriter();
  if (!writer) return NextResponse.json({ text: null });
  const today = serverToday();
  const [{ data: summary }, { data: cats }] = await Promise.all([
    db.rpc("month_close_summary", { p_month: month, p_today: today }),
    db.from("categories").select("id,name").is("parent_id", null),
  ]);
  if (!summary) return NextResponse.json({ text: null });
  const names = Object.fromEntries(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const text = await writeMonthSummary(writer, monthSummaryFacts(summary as CloseSummary, names, today));
  if (text) await db.from("month_closes").update({ summary: text }).eq("month", month);
  return NextResponse.json({ text });
}
