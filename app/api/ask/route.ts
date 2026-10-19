import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { anthropicAsk } from "@/lib/ai/ask/anthropic";
import { answerQuestion, type PriorTurn } from "@/lib/ai/ask/run";
import { stubModel } from "@/lib/ai/ask/stub";
import type { AskModel, CatRow } from "@/lib/ai/ask/types";
import { ASK_PER_DAY, askedToday, serverToday, tokenCap, tokensUsedThisMonth } from "@/lib/ai/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(1, "Ask a question first.").max(500, "Keep the question under 500 characters.") });

function chooseModel(today: string, categories: CatRow[]): AskModel | null {
  if (process.env.STERLING_ASK_STUB) return stubModel(today, categories);   // tests only: no API key in the E2E run
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? anthropicAsk(key) : null;
}

/** Ask Sterling: a question in, a grounded answer out. Runs as the signed-in user, so RLS applies to every tool. */
export async function POST(req: NextRequest) {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Ask a question first." }, { status: 400 });

  const { data: profile } = await db.from("profiles").select("ai_enabled, ai_include_notes").eq("id", auth.user.id).single();
  const p = profile as { ai_enabled: boolean; ai_include_notes: boolean } | null;
  if (p?.ai_enabled === false) return NextResponse.json({ error: "AI is switched off in Settings → AI insights." }, { status: 403 });
  const today = serverToday();
  if ((await askedToday(db, auth.user.id, today)) >= ASK_PER_DAY) return NextResponse.json({ error: `You've asked ${ASK_PER_DAY} questions today. Try again tomorrow.` }, { status: 429 });
  if ((await tokensUsedThisMonth(db, auth.user.id, today)) >= tokenCap()) return NextResponse.json({ error: "This month's AI allowance is used up. It resets on the 1st." }, { status: 429 });

  const [{ data: cats }, { data: pots }, { data: prev }] = await Promise.all([
    db.from("categories").select("id,name,parent_id,kind").is("archived_at", null),
    db.from("pots").select("name").order("created_at"),
    db.from("ask_turns").select("question,answer,facts").order("created_at", { ascending: false }).limit(3),
  ]);
  const categories = (cats ?? []) as CatRow[];
  const model = chooseModel(today, categories);
  if (!model) return NextResponse.json({ error: "Ask Sterling needs an Anthropic API key on the server (ANTHROPIC_API_KEY)." }, { status: 503 });

  try {
    const result = await answerQuestion({
      model, ctx: { db, today, categories }, pots: ((pots ?? []) as { name: string }[]).map((x) => x.name), includeNotes: !!p?.ai_include_notes,
      question: body.data.question, history: ((prev ?? []) as PriorTurn[]).reverse(),
    });
    const { data: turn, error } = await db.from("ask_turns").insert({
      question: body.data.question, answer: result.answer, facts: result.facts, used_fallback: result.usedFallback,
      model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens,
    }).select("id,question,answer,facts,used_fallback,model,created_at").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ turn });
  } catch (e) {
    console.error("[ask]", e);
    return NextResponse.json({ error: "I couldn't answer that just now. Please try again." }, { status: 500 });
  }
}
