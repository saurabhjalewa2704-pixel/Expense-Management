// The PRD §12.8 acceptance check, for the owner to run with real credentials:
//   ANTHROPIC_API_KEY=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/ai-check.ts [runs=20] [scope=adhoc]
// Builds the facts for the (single) user once, asks the model for cards `runs` times, and reports how many figures it quoted,
// how many cards the grounding validator dropped, and how often the template fallback was needed. Nothing is stored.
// Target: 0 ungrounded figures SHOWN (guaranteed by construction) and the model's own drop rate low enough that fallback is rare.
import { createClient } from "@supabase/supabase-js";
import { todayLondon } from "@/lib/dates";
import { buildFacts } from "@/lib/ai/facts";
import { narrate } from "@/lib/ai/generate";
import { figuresIn } from "@/lib/ai/validator";
import { anthropicWriter } from "@/lib/ai/writer";

const need = (k: string) => process.env[k] ?? (console.error(`missing ${k}`), process.exit(1));
const runs = Number(process.argv[2] ?? 20);
const scope = (process.argv[3] ?? "adhoc") as "weekly" | "monthly" | "adhoc";

const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const writer = anthropicWriter(need("ANTHROPIC_API_KEY"));
const { data: profiles } = await db.from("profiles").select("id").limit(2);
if (!profiles?.length) { console.error("no profile found"); process.exit(1); }
const facts = await buildFacts(db, { scope, today: todayLondon(), includeNotes: false });
const shown = new Set(facts.facts.map((f) => f.display));

let dropped = 0, fallback = 0, cards = 0, ungrounded = 0, tokens = 0;
for (let i = 1; i <= runs; i++) {
  const n = await narrate(facts, writer, (m, d) => console.log(`  run ${i}: ${m}`, d ? JSON.stringify(d) : ""));
  dropped += n.dropped.length; fallback += n.usedFallback ? 1 : 0; cards += n.cards.length; tokens += n.inputTokens + n.outputTokens;
  for (const c of n.cards) for (const f of figuresIn(`${c.title} ${c.body}`)) if (!shown.has(f)) { ungrounded++; console.error(`UNGROUNDED in run ${i}: ${f}  (${c.title})`); }
}
console.log(`\n${runs} runs · ${cards} cards shown · ${ungrounded} ungrounded figures shown · ${dropped} model cards dropped by the validator · ${fallback} runs topped up from templates · ${tokens} tokens`);
process.exit(ungrounded ? 1 : 0);
