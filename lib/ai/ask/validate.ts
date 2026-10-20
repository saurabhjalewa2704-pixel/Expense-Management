// The grounding check for answers (PRD §12.4, applied to chat): every £ figure and percentage in the answer must be a `display`
// string a tool returned for this question (or for one of the last few turns, so follow-ups can refer back). Nothing else is shown.
import { figuresIn } from "@/lib/ai/validator";
import type { ToolFact } from "./types";

export interface AnswerCheck { ok: boolean; bad: string[] }

export function validateAnswer(text: string, facts: readonly ToolFact[]): AnswerCheck {
  if (!text.trim()) return { ok: false, bad: ["the answer is empty"] };
  const allowed = new Set(facts.map((f) => f.display));
  const bad = [...new Set(figuresIn(text).filter((f) => !allowed.has(f)))];
  return { ok: bad.length === 0, bad };
}

/** When the wording cannot be trusted, show the figures themselves: still the user's own numbers, still labelled. */
export function fallbackAnswer(facts: readonly ToolFact[]): string {
  if (facts.length === 0) return "I couldn't find anything to answer that from your data. Try asking about a category, a month or a payee.";
  const seen = new Set<string>();
  const lines = facts.filter((f) => (seen.has(`${f.label}|${f.display}`) ? false : (seen.add(`${f.label}|${f.display}`), true))).slice(0, 10).map((f) => `• ${f.label}: ${f.display}`);
  return `I couldn't word that reliably, so here are the figures I found:\n${lines.join("\n")}`;
}
