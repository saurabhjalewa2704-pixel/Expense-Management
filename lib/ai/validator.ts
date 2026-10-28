// The grounding validator (PRD §12.4): non-negotiable. Every currency figure and percentage in a card's title and body
// must exactly match a `display` string in the facts payload; a card with any other number is dropped. Model text that
// has not passed this is never shown.
import type { Card, Facts } from "./types";

// Thousands are grouped (1,812.40), so a comma that merely follows an amount ("£226, up 38%") is not part of it.
const MONEY = /£(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/g;
const PERCENT = /\d+(?:\.\d+)?%/g;

export const figuresIn = (text: string): string[] => [...(text.match(MONEY) ?? []), ...(text.match(PERCENT) ?? [])];

export interface Dropped { card: Card; reasons: string[] }
export interface Validation { valid: Card[]; dropped: Dropped[] }

export function validateCards(cards: readonly Card[], facts: Facts): Validation {
  const displays = new Set(facts.facts.map((f) => f.display));
  const factKeys = new Set(facts.facts.map((f) => f.key));
  const entityIds = new Set(facts.entities.map((e) => e.id));
  const valid: Card[] = [];
  const dropped: Dropped[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const reasons: string[] = [];
    for (const fig of figuresIn(`${card.title} ${card.body}`)) {
      if (!displays.has(fig)) reasons.push(`"${fig}" is not a figure in the facts`);
    }
    if (card.metric && !factKeys.has(card.metric.fact_key)) reasons.push(`metric fact "${card.metric.fact_key}" does not exist`);
    if (card.metric?.delta_fact_key && !factKeys.has(card.metric.delta_fact_key)) reasons.push(`delta fact "${card.metric.delta_fact_key}" does not exist`);
    if (seen.has(card.key)) reasons.push(`duplicate card key "${card.key}"`);
    if (reasons.length) { dropped.push({ card, reasons }); continue; }
    seen.add(card.key);
    // a link to something that does not exist is removed, the card itself is fine
    const link = card.link && (card.link.kind === "screen" ? ["/activity", "/analytics", "/cash", "/insights"].includes(card.link.id) || (facts.scope === "trip" && card.link.id === `/trips/${facts.trip_id}`) : entityIds.has(card.link.id)) ? card.link : undefined;
    valid.push({ ...card, link });
  }
  return { valid, dropped };
}

/** The failure list given back to the model on the single retry. */
export const failureList = (dropped: readonly Dropped[]): string =>
  dropped.map((d) => `- Card "${d.card.key}": ${d.reasons.join("; ")}`).join("\n");
