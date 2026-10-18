// Model IDs live here (PRD §12.1). Check current names and pricing at https://docs.claude.com before changing them.
export const MODELS = {
  /** Insight digests: narrative over numbers. */
  digest: "claude-sonnet-5-5",
  /** Natural-language parse and payee guesses (P1): fast and cheap, latency matters inside Quick Add. */
  parse: "claude-haiku-5-5",
} as const;
