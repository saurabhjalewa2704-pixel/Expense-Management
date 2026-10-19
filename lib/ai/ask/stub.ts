// A scripted stand-in for the model, used only when STERLING_ASK_STUB is set (the E2E run has no API key). It picks tools from
// keywords and words the result from the returned figures, so the real tools, validator, retry, fallback and UI all run.
import { addDays, addMonths, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import type { AskModel, AskStep, Block, CatRow, Msg } from "./types";

const firstUserText = (messages: Msg[]) => {
  const users = messages.filter((m) => m.role === "user" && typeof m.content === "string") as { content: string }[];
  return users.find((m) => !m.content.startsWith("An automatic check rejected"))?.content ?? "";
};
const question = (messages: Msg[]) => {
  const plain = messages.filter((m) => m.role === "user" && typeof m.content === "string" && !(m.content as string).startsWith("An automatic check rejected")) as { content: string }[];
  return plain[plain.length - 1]?.content ?? firstUserText(messages);
};

export function stubModel(today: ISODate, categories: CatRow[]): AskModel {
  const lastMonth = addMonths(monthStart(today), -1);
  const id = (name: string) => categories.find((c) => c.name === name && !c.parent_id)?.id;
  let n = 0;
  return {
    id: "stub",
    async step({ messages }): Promise<AskStep> {
      const q = question(messages).toLowerCase();
      const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result") : []));
      const retried = messages.some((m) => typeof m.content === "string" && m.content.startsWith("An automatic check rejected"));
      const done = (content: Block[]): AskStep => ({ content, stopReason: "end_turn", inputTokens: 100, outputTokens: 40 });
      const call = (name: string, input: unknown): AskStep => ({ content: [{ type: "tool_use", id: `stub_${++n}`, name, input }], stopReason: "tool_use", inputTokens: 100, outputTokens: 20 });

      if (results.length === 0) {
        if (/cash|balance|money do i have/.test(q)) return call("cash_position", {});
        if (/\bpot\b|pots|house|home purchase|stamp duty/.test(q)) return call("pot_summary", {});
        if (/payee|where do i spend|shop/.test(q)) return call("top_payees", { from: monthStart(today), to: today });
        if (/weekday|which day/.test(q)) return call("spend_by_weekday", { from: addDays(today, -89), to: today });
        if (/compare|versus|\bvs\b/.test(q)) return call("compare_periods", { current_from: monthStart(today), current_to: today, baseline_from: lastMonth, baseline_to: monthEnd(lastMonth) });
        if (/eating out|restaurant/.test(q) && /last month|september/.test(q)) return call("spend_summary", { from: lastMonth, to: monthEnd(lastMonth), category_id: id("Eating out") });
        if (/eating out|restaurant/.test(q)) return call("spend_summary", { from: monthStart(today), to: today, category_id: id("Eating out") });
        return call("spend_summary", { from: monthStart(today), to: today });
      }
      const first = JSON.parse((results[0] as { content: string }).content) as { facts?: { label: string; display: string }[] };
      const facts = first.facts ?? [];
      const grounded = facts.slice(0, 3).map((f) => `${f.label}: ${f.display}`).join(". ");
      if (/ungrounded forever/.test(q)) return done([{ type: "text", text: "You spent £999,999.99 on that, which is 77% more than usual." }]);
      if (/ungrounded/.test(q) && !retried) return done([{ type: "text", text: "You spent £999,999.99 on that." }]);
      return done([{ type: "text", text: facts.length ? `Here's what I found. ${grounded}.` : "I couldn't find anything for that." }]);
    },
  };
}
