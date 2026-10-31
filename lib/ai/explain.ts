import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./models";

/** What went wrong, in words the owner can act on. Only our own errors and Anthropic's status text are shown; nothing secret. */
export function explainAiError(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    if (s === 401) return "Anthropic refused the API key (401). Check ANTHROPIC_API_KEY in Vercel: it may be wrong, revoked or have stray spaces.";
    if (s === 403) return "Anthropic says this key isn't allowed to do that (403). Check the key's workspace and permissions.";
    if (s === 404) return `Anthropic doesn't know the model name (404). The app asks for “${MODELS.ask}” and “${MODELS.parse}”; they may not be available to this key.`;
    if (s === 400 && /credit|billing|balance/i.test(e.message)) return "Anthropic says the account has no credit left. Add credit under Plans & Billing in the Anthropic console.";
    if (s === 429) return "Anthropic is rate-limiting this key (429). Try again in a minute.";
    if (s && s >= 500) return `Anthropic had a problem (${s}). Try again shortly.`;
    return `Anthropic returned an error (${s ?? "no status"}): ${e.message.slice(0, 160)}`;
  }
  const m = e instanceof Error ? e.message : String(e);
  if (/relation .* does not exist|column .* does not exist|function .* does not exist|schema cache/i.test(m)) return "The database is missing a migration this feature needs. Run the pending migrations in the Supabase SQL Editor (see the README).";
  if (/fetch failed|ENOTFOUND|ECONN|timeout/i.test(m)) return "The server couldn't reach Anthropic (network error).";
  return "Something unexpected failed on the server. The details are in the Vercel function logs.";
}

