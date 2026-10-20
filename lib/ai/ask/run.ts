import { askSystem, retryNote } from "./prompt";
import { runTool, TOOL_DEFS, type AskCtx } from "./tools";
import type { AskModel, Block, Msg, ToolFact } from "./types";
import { fallbackAnswer, validateAnswer } from "./validate";

export interface PriorTurn { question: string; answer: string; facts: ToolFact[] }
export interface AskResult { answer: string; facts: ToolFact[]; usedFallback: boolean; inputTokens: number; outputTokens: number; model: string; toolCalls: string[] }

const MAX_STEPS = 6;
const text = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();

/**
 * The loop: the model asks for tools, we run them, it words the result, the grounding check accepts or rejects the wording.
 * One rejection gets one retry with the list of offending figures; a second rejection (or running out of steps) falls back to
 * listing the figures themselves. Whatever is returned has passed the check or is built from tool output only.
 */
export async function answerQuestion(o: { model: AskModel; ctx: AskCtx; pots: string[]; includeNotes: boolean; question: string; history: PriorTurn[] }): Promise<AskResult> {
  const system = askSystem({ today: o.ctx.today, categories: o.ctx.categories, pots: o.pots, includeNotes: o.includeNotes });
  const messages: Msg[] = [];
  for (const t of o.history.slice(-3)) messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
  messages.push({ role: "user", content: o.question });
  const prior = o.history.slice(-3).flatMap((t) => t.facts);
  const facts: ToolFact[] = [];
  const toolCalls: string[] = [];
  let inputTokens = 0, outputTokens = 0, retried = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await o.model.step({ system, messages, tools: TOOL_DEFS });
    inputTokens += res.inputTokens; outputTokens += res.outputTokens;
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length) {
      const results: Block[] = [];
      for (const u of uses) {
        toolCalls.push(u.name);
        try {
          const out = await runTool(o.ctx, u.name, u.input);
          facts.push(...out.facts);
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const answer = text(res.content);
    const check = validateAnswer(answer, [...facts, ...prior]);
    if (check.ok) return { answer, facts, usedFallback: false, inputTokens, outputTokens, model: o.model.id, toolCalls };
    if (retried) break;
    retried = true;
    messages.push({ role: "user", content: retryNote(check.bad) });
  }
  return { answer: fallbackAnswer(facts), facts, usedFallback: true, inputTokens, outputTokens, model: o.model.id, toolCalls };
}
