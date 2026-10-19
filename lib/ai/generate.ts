// compute first, narrate second, validate, then store (PRD §12.2). The model's text is shown only if it passes the grounding
// validator; otherwise the deterministic fallback renders the same facts, so the screen is never empty and never wrong.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ISODate } from "@/lib/dates";
import { buildFacts, periodFor } from "./facts";
import { fallbackCards } from "./fallback";
import { Card, type Facts } from "./types";
import { failureList, validateCards, type Dropped } from "./validator";
import type { CardWriter } from "./writer";

export const MIN_CARDS = 3;

export interface Narration {
  cards: Card[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  usedFallback: boolean;
  dropped: Dropped[];
}

type Log = (message: string, data?: unknown) => void;

function parseCards(raw: unknown[]): { cards: Card[]; bad: Dropped[] } {
  const cards: Card[] = [], bad: Dropped[] = [];
  for (const r of raw) {
    const p = Card.safeParse(r);
    if (p.success) cards.push(p.data);
    else bad.push({ card: { key: String((r as { key?: unknown })?.key ?? "?"), type: "suggestion", severity: "info", title: "", body: "", viz: "none", rank: 1 }, reasons: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  return { cards, bad };
}

/** The narration step on its own (no database): writer → validate → one retry → fallback. */
export async function narrate(facts: Facts, writer: CardWriter | null, log: Log = () => {}): Promise<Narration> {
  const out: Narration = { cards: [], model: writer?.model ?? "template", inputTokens: 0, outputTokens: 0, usedFallback: false, dropped: [] };
  if (writer) {
    let failures: string | undefined;
    for (let attempt = 1; attempt <= 2 && out.cards.length < MIN_CARDS; attempt++) {
      try {
        const res = await writer.write(facts, failures);
        out.inputTokens += res.inputTokens; out.outputTokens += res.outputTokens;
        const { cards, bad } = parseCards(res.cards);
        const { valid, dropped } = validateCards(cards, facts);
        const known = new Set(out.cards.map((c) => c.key));
        out.cards.push(...valid.filter((c) => !known.has(c.key)));
        out.dropped.push(...bad, ...dropped);
        failures = failureList([...bad, ...dropped]);
        if (bad.length + dropped.length) log("cards dropped by the grounding validator", { attempt, dropped: [...bad, ...dropped].map((d) => ({ key: d.card.key, reasons: d.reasons })) });
      } catch (e) {
        log("the model call failed", String(e));
        break;
      }
    }
  }
  if (out.cards.length < MIN_CARDS) {
    // fewer than three survived (even after the retry): top up from the deterministic cards, grounded by construction
    for (const f of fallbackCards(facts)) {
      if (out.cards.length >= MIN_CARDS && writer) break;
      if (!out.cards.some((c) => c.key === f.key || (c.type === f.type && c.link?.id === f.link?.id && c.link))) { out.cards.push(f); out.usedFallback = true; }
      if (out.cards.length >= 6) break;
    }
  }
  out.cards = out.cards.slice(0, 6).map((c, i) => ({ ...c, rank: i + 1 }));
  return out;
}

export interface GenerateOptions {
  db: SupabaseClient;
  userId: string;
  scope: Facts["scope"];
  today: ISODate;
  writer: CardWriter | null;
  includeNotes?: boolean;
  /** Tokens already used this month and the monthly cap; at or above the cap the model is skipped. */
  usedTokens?: number;
  tokenCap?: number;
  log?: Log;
}

export interface InsightRunRow {
  id: string; scope: string; period_start: ISODate; period_end: ISODate; facts: Facts; cards: Card[]; model: string;
  input_tokens: number | null; output_tokens: number | null; used_fallback: boolean; created_at: string;
}

export async function generateInsights(o: GenerateOptions): Promise<InsightRunRow> {
  const log = o.log ?? (() => {});
  const facts = await buildFacts(o.db, { scope: o.scope, today: o.today, includeNotes: !!o.includeNotes });
  const capped = o.tokenCap !== undefined && (o.usedTokens ?? 0) >= o.tokenCap;
  if (capped) log("monthly AI token cap reached: using template cards");
  const n = await narrate(facts, capped ? null : o.writer, log);
  const { period } = periodFor(o.scope, o.today);
  const { data, error } = await o.db.from("insight_runs").insert({
    user_id: o.userId, scope: o.scope, period_start: period.from, period_end: period.to, facts, cards: n.cards, model: capped ? "template (token cap)" : n.model,
    input_tokens: n.inputTokens, output_tokens: n.outputTokens, used_fallback: n.usedFallback,
    validation: { dropped: n.dropped.map((d) => ({ key: d.card.key, reasons: d.reasons })) },
  }).select().single();
  if (error) throw new Error(`could not store the insight run: ${error.message}`);
  return data as InsightRunRow;
}
