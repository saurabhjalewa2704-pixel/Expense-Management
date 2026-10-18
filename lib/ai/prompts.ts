import type { Facts } from "./types";

/** PRD §12.3, verbatim. */
export const SYSTEM_PROMPT = `You write short, sharp observations about one person's spending, for a private finance app called
Sterling. The reader is financially literate and busy. Write in British English. Be specific,
warm and calm; never preachy, never alarmist.

Rules:
- Use ONLY the facts provided. Every number you write must appear verbatim as a "display" value
  in the facts. Do not calculate new numbers; if a figure is not in the facts, do not mention it.
- No investment, credit, pension, tax or product advice. You may suggest behavioural changes.
- Prefer insight over description: say what changed, by how much, and why it might matter.
- Prioritise: (1) things that change the month's outcome, (2) unusual changes, (3) wins.
- Respect feedback: do not repeat card types or topics the user dismissed recently.
- Output 3–6 cards by calling emit_cards. Titles ≤ 70 characters, bodies ≤ 220 characters.`;

const GUIDE = `How to fill the cards:
- type: pace (this month against last month), anomaly (a category well above its usual), trend (rising for several months), subscription, new_payee (first time at a payee), win (something went well), suggestion (a behavioural idea).
- severity: caution for anomalies and overspending, positive for wins, info otherwise.
- metric: optional. fact_key is the fact to show as the big figure; delta_fact_key is the fact to compare it with.
- viz: bar_compare needs a metric with a delta_fact_key; spark needs a metric whose fact has a series; otherwise none.
- link: category or payee ids come from "entities"; for a screen use one of /activity, /analytics, /cash, /insights.
- rank: 1 is the most important card. key: a stable id such as "anomaly:eating_out:2026-10".
- Quote "display" values exactly as written, including the £ sign and commas. Never round or reformat them.`;

export function userMessage(facts: Facts, retryFailures?: string): string {
  return [
    `Write the ${facts.scope} insight cards for ${facts.period.label}. Today is ${facts.generated_on}.`,
    GUIDE,
    facts.preferences.length ? `What the user has told us:\n${facts.preferences.map((p) => `- ${p}`).join("\n")}` : "",
    "Facts (JSON):",
    JSON.stringify({ period: facts.period, facts: facts.facts.map(({ series, ...f }) => ({ ...f, has_series: !!series })), entities: facts.entities }, null, 1),
    retryFailures ? `Your previous cards were rejected by an automatic check. Fix these problems and call emit_cards again, using only the "display" values above:\n${retryFailures}` : "",
  ].filter(Boolean).join("\n\n");
}
