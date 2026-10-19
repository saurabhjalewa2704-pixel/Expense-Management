import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS } from "./models";
import { SYSTEM_PROMPT, userMessage } from "./prompts";
import { CardsInput, type Facts } from "./types";

export interface WriterResult { cards: unknown[]; inputTokens: number; outputTokens: number }
/** Anything that can turn facts into candidate cards. The pipeline validates whatever comes back. */
export interface CardWriter { model: string; write(facts: Facts, retryFailures?: string): Promise<WriterResult> }

const { $schema: _unused, ...cardsSchema } = z.toJSONSchema(CardsInput) as Record<string, unknown>;
void _unused;

/** The real writer: Claude, forced to answer through the `emit_cards` tool so the output is structured. Server-side only. */
export function anthropicWriter(apiKey: string, model: string = MODELS.digest): CardWriter {
  const client = new Anthropic({ apiKey });
  return {
    model,
    async write(facts, retryFailures) {
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [{ name: "emit_cards", description: "Emit the insight cards for the user.", input_schema: cardsSchema as Anthropic.Tool.InputSchema }],
        tool_choice: { type: "tool", name: "emit_cards" },
        messages: [{ role: "user", content: userMessage(facts, retryFailures) }],
      });
      const block = res.content.find((b) => b.type === "tool_use" && b.name === "emit_cards");
      const input = block && block.type === "tool_use" ? (block.input as { cards?: unknown[] }) : undefined;
      return { cards: Array.isArray(input?.cards) ? input.cards : [], inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    },
  };
}
