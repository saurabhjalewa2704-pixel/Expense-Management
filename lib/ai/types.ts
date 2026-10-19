import { z } from "zod";
import type { ISODate } from "@/lib/dates";

/** One number (or name) the model may quote. `display` is the exact string it must use. */
export interface Fact {
  key: string;
  label: string;
  display: string;
  value_pence?: number;
  value?: number;
  /** For `spark` visuals: a series the client draws itself. */
  series?: number[];
}

/** Things a card can link to. The model refers to them by id; unknown ids are dropped. */
export interface Entity { id: string; kind: "category" | "payee"; name: string }

export interface Facts {
  generated_on: ISODate;
  scope: "weekly" | "monthly" | "adhoc";
  period: { from: ISODate; to: ISODate; label: string; compare_label: string };
  facts: Fact[];
  entities: Entity[];
  /** What the user has said about earlier cards (last 50 feedback items), as plain sentences. */
  preferences: string[];
}

export const CARD_TYPES = ["pace", "anomaly", "trend", "subscription", "new_payee", "win", "suggestion"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const Card = z.object({
  key: z.string().min(1).max(80),                                          // stable id, e.g. "anomaly:eating_out:2026-10"
  type: z.enum(CARD_TYPES),
  severity: z.enum(["info", "positive", "caution"]),
  title: z.string().max(70),
  body: z.string().max(220),
  metric: z.object({ fact_key: z.string(), delta_fact_key: z.string().optional() }).optional(),
  viz: z.enum(["spark", "bar_compare", "none"]).default("none"),
  link: z.object({ kind: z.enum(["category", "payee", "screen"]), id: z.string() }).optional(),
  rank: z.number().int().min(1).max(6),
});
export type Card = z.infer<typeof Card>;
export const CardsInput = z.object({ cards: z.array(Card).min(1).max(6) });
