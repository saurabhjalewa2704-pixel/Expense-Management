import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { explainAiError } from "./explain";
import { MODELS } from "./models";

/** One tiny request per model, so Settings can say which part is broken. */
export async function checkAnthropic(): Promise<{ key: boolean; models: { id: string; ok: boolean; message?: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { key: false, models: [] };
  const client = new Anthropic({ apiKey });
  const models: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of [...new Set<string>([MODELS.digest, MODELS.ask, MODELS.parse])]) {
    try { await client.messages.create({ model: id, max_tokens: 8, messages: [{ role: "user", content: "Reply with: ok" }] }); models.push({ id, ok: true }); }
    catch (e) { models.push({ id, ok: false, message: explainAiError(e) }); }
  }
  return { key: true, models };
}

export { explainAiError };
