import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/ai/models";
import type { AskModel, Block } from "./types";

/** The real model. The system prompt carries the category catalogue, so it is cached across a conversation's steps. */
export function anthropicAsk(apiKey: string, model: string = MODELS.ask): AskModel {
  const client = new Anthropic({ apiKey });
  return {
    id: model,
    async step({ system, messages, tools }) {
      const res = await client.messages.create({
        model,
        max_tokens: 1200,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
        messages: messages as Anthropic.MessageParam[],
      });
      const content: Block[] = res.content.flatMap((b): Block[] =>
        b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }] : []);
      return { content, stopReason: res.stop_reason ?? "end_turn", inputTokens: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens };
    },
  };
}
