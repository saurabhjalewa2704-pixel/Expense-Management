// Run Ask Sterling against the real model with your own data (the stub used by the tests proves the plumbing, not the wording):
//   ANTHROPIC_API_KEY=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/ask-check.ts
// Asks a fixed set of questions, prints each answer and the tools it used, and reports how many answers had to fall back to
// listing figures (the grounding check rejected the model's wording twice). Nothing is stored.
import { createClient } from "@supabase/supabase-js";
import { anthropicAsk } from "@/lib/ai/ask/anthropic";
import { answerQuestion } from "@/lib/ai/ask/run";
import type { CatRow } from "@/lib/ai/ask/types";
import { todayLondon } from "@/lib/dates";

const need = (k: string) => process.env[k] ?? (console.error(`missing ${k}`), process.exit(1));
const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const model = anthropicAsk(need("ANTHROPIC_API_KEY"));
const QUESTIONS = [
  "What did I spend on eating out last month?",
  "How does this month compare with last month?",
  "Where do I spend the most?",
  "Which day of the week do I spend the most?",
  "What was my biggest purchase this year?",
  "How much cash do I have right now?",
  "Has my grocery spending gone up over the last six months?",
  "How much have I spent on transport in the last 90 days?",
  "What's the weather like?",
];

const { data: cats } = await db.from("categories").select("id,name,parent_id,kind").is("archived_at", null);
const { data: pots } = await db.from("pots").select("name");
const ctx = { db, today: todayLondon(), categories: (cats ?? []) as CatRow[] };
let fallbacks = 0, tokens = 0;
for (const q of QUESTIONS) {
  const r = await answerQuestion({ model, ctx, pots: (pots ?? []).map((p) => p.name as string), includeNotes: false, question: q, history: [] });
  fallbacks += r.usedFallback ? 1 : 0; tokens += r.inputTokens + r.outputTokens;
  console.log(`\nQ: ${q}\nA${r.usedFallback ? " (fallback)" : ""}: ${r.answer}\n   tools: ${r.toolCalls.join(", ") || "none"} · ${r.inputTokens + r.outputTokens} tokens`);
}
console.log(`\n${QUESTIONS.length} questions · ${fallbacks} fell back to listing figures · ${tokens} tokens`);
