import { describe, expect, it } from "vitest";
import { assembleFacts, periodFor, slug, type FactsInput } from "@/lib/ai/facts";
import { fallbackCards } from "@/lib/ai/fallback";
import { narrate, MIN_CARDS } from "@/lib/ai/generate";
import { Card, type Facts } from "@/lib/ai/types";
import { figuresIn, validateCards } from "@/lib/ai/validator";
import type { CardWriter, WriterResult } from "@/lib/ai/writer";

// Appendix A (Sun 18 Oct 2026) as the facts engine sees it
const input: FactsInput = {
  today: "2026-10-18", scope: "adhoc",
  period: { from: "2026-10-01", to: "2026-10-18", label: "October so far", compare_label: "earlier months at the same point" },
  pace: { month_start: "2026-10-01", day_of_month: 18, days_in_month: 31, spend_pence: 323685, prev_spend_pence: 360410, prev_label_day: 18, prev_total_pence: 531620 },
  projected: 506200, monthAvg: 534926,
  history: [
    { category_id: "c-home", name: "Home", icon: "house", parent_id: null, current_pence: 181240, prior_pence: [180800, 181420, 180360, 179880, 181140, 180520] },
    { category_id: "c-groc", name: "Groceries", icon: "shopping-cart", parent_id: null, current_pence: 38625, prior_pence: [37240, 35530, 36845, 35840, 35210, 36400] },
    { category_id: "c-eat", name: "Eating out", icon: "utensils", parent_id: null, current_pence: 31260, prior_pence: [22620, 25510, 22600, 24130, 19840, 20975] },
    { category_id: "c-trans", name: "Transport", icon: "train-front", parent_id: null, current_pence: 21480, prior_pence: [26215, 24730, 23160, 26800, 24010, 25490] },
    { category_id: "c-shop", name: "Shopping", icon: "shopping-bag", parent_id: null, current_pence: 17890, prior_pence: [21430, 30120, 18999, 19840, 24560, 16000] },
  ],
  trends: { "c-groc": [{ month: "2026-06-01", total_pence: 51200 }, { month: "2026-07-01", total_pence: 54000 }, { month: "2026-08-01", total_pence: 57800 }, { month: "2026-09-01", total_pence: 60400 }] },
  streaming: { id: "c-stream", name: "Streaming & apps", months: [{ month: "2026-07-01", total_pence: 3897 }, { month: "2026-08-01", total_pence: 3897 }, { month: "2026-09-01", total_pence: 4197 }, { month: "2026-10-01", total_pence: 4197 }] },
  newPayees: [{ payee_id: "p-dishoom", name: "Dishoom Kensington", amount_pence: 8650, occurred_on: "2026-10-17" }],
  big: [{ id: "t1", payee_name: "Dishoom Kensington", category_name: "Restaurants", amount_pence: 8650, occurred_on: "2026-10-17" }],
  weekdayAvg: [1000, 900, 800, 10500, 1200, 16582, 2000], series: [100, 200, 300], feedback: [],
};
const facts = assembleFacts(input);
const display = (k: string) => facts.facts.find((f) => f.key === k)?.display;

describe("facts engine", () => {
  it("states the pace, the usual and the flags with pre-formatted figures", () => {
    expect(display("spend_mtd")).toBe("£3,236.85");
    expect(display("spend_prev_same_point")).toBe("£3,604.10");
    expect(display("pace_gap")).toBe("£367");
    expect(display("pace_dir")).toBe("under");
    expect(display("projected_spend")).toBe("£5,062");
    expect(display("cat:eating_out:total")).toBe("£312.60");
    expect(display("cat:eating_out:usual")).toBe("£226");
    expect(display("cat:eating_out:pct_over")).toBe("38%");
    expect(display("cat:transport:low")).toBe("6");              // lowest of six earlier periods
    expect(display("cat:groceries:trend_len")).toBe("4");
    expect(display("cat:groceries:trend_first")).toBe("£512");
    expect(display("streaming_now")).toBe("£41.97");
    expect(display("streaming_delta")).toBe("£3.00");
    expect(display("weekday_top_avg")).toBe("£165.82");
    expect(facts.facts.find((f) => f.key === "spend_mtd")?.series).toEqual([100, 200, 300]);
  });
  it("flags nothing for a category near its usual, and needs enough history for 'usual'", () => {
    expect(display("cat:home:pct_over")).toBeUndefined();
    const short = assembleFacts({ ...input, history: [{ ...input.history[2]!, prior_pence: [10000, 11000] }] });
    expect(short.facts.find((f) => f.key === "cat:eating_out:usual")).toBeUndefined();
  });
  it("turns feedback into preferences", () => {
    const f = assembleFacts({ ...input, feedback: [{ card_type: "suggestion", card_key: "a", action: "dismissed" }, { card_type: "suggestion", card_key: "b", action: "dismissed" }, { card_type: "win", card_key: "c", action: "helpful" }] });
    expect(f.preferences.join(" ")).toContain('dismissed 2 "suggestion" cards');
    expect(f.preferences.join(" ")).toContain('found 1 "win" card helpful');
  });
  it("picks the digest period", () => {
    expect(periodFor("weekly", "2026-10-19").period).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });   // Monday: the week just ended
    expect(periodFor("weekly", "2026-10-21").period).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(periodFor("monthly", "2026-10-01").period).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodFor("adhoc", "2026-10-18").period).toMatchObject({ from: "2026-10-01", to: "2026-10-18" });
    expect(slug("Family & giving")).toBe("family_and_giving");
  });
});

describe("grounding validator (PRD §12.4)", () => {
  const card = (over: Partial<Card>): Card => ({ key: "k", type: "anomaly", severity: "caution", title: "Eating out is up 38% on your usual", body: "£312.60 so far, against about £226 by this point.", viz: "none", rank: 1, ...over });
  it("extracts currency figures and percentages", () => {
    expect(figuresIn("£312.60 vs £226, up 38% (£1,812.40)")).toEqual(["£312.60", "£226", "£1,812.40", "38%"]);
  });
  it("accepts figures that match a display exactly", () => {
    expect(validateCards([card({})], facts).valid).toHaveLength(1);
  });
  it("rejects an invented figure", () => {
    const r = validateCards([card({ body: "£312.60 so far, against about £250." })], facts);
    expect(r.valid).toHaveLength(0);
    expect(r.dropped[0]!.reasons[0]).toContain("£250");
  });
  it("rejects altered rounding", () => {
    expect(validateCards([card({ body: "£312.60 so far, against £226.10 usually." })], facts).valid).toHaveLength(0);   // the fact is "£226"
    expect(validateCards([card({ body: "£312.6 so far." })], facts).valid).toHaveLength(0);
    expect(validateCards([card({ title: "Eating out is up 37% on your usual" })], facts).valid).toHaveLength(0);
    expect(validateCards([card({ body: "Roughly £2.9k a month." })], facts).valid).toHaveLength(0);
  });
  it("rejects missing metric facts and duplicate keys, and strips only unknown links", () => {
    expect(validateCards([card({ metric: { fact_key: "nope" } })], facts).valid).toHaveLength(0);
    expect(validateCards([card({ key: "x" }), card({ key: "x" })], facts).valid).toHaveLength(1);
    const kept = validateCards([card({ link: { kind: "category", id: "c-eat" } }), card({ key: "y", link: { kind: "category", id: "made-up" } })], facts);
    expect(kept.valid[0]!.link).toEqual({ kind: "category", id: "c-eat" });
    expect(kept.valid[1]!.link).toBeUndefined();
  });
  it("accepts text with no figures", () => expect(validateCards([card({ title: "Nothing unusual", body: "A quiet week." })], facts).valid).toHaveLength(1));
});

describe("fallback cards are deterministic, grounded and sized", () => {
  const cards = fallbackCards(facts);
  it("render from the facts only", () => {
    expect(validateCards(cards, facts).dropped).toEqual([]);
    expect(cards.length).toBeGreaterThanOrEqual(MIN_CARDS);
    for (const c of cards) { expect(c.title.length).toBeLessThanOrEqual(70); expect(c.body.length).toBeLessThanOrEqual(220); expect(Card.safeParse(c).success).toBe(true); }
    expect(cards[0]!.title).toBe("You're £367 under September's pace");
    expect(cards.find((c) => c.type === "anomaly")!.title).toBe("Eating out is running 38% above your usual");
    expect(cards.find((c) => c.type === "win")!.title).toBe("Transport is your lowest in 6 months: £214.80");
  });
  it("never leaves the screen empty", () => {
    const bare = assembleFacts({ ...input, history: [], trends: {}, streaming: undefined, newPayees: [], big: [], weekdayAvg: [0, 0, 0, 0, 0, 0, 0], pace: { ...input.pace, spend_pence: 0, prev_spend_pence: 0 } });
    const c = fallbackCards(bare);
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(validateCards(c, bare).dropped).toEqual([]);
  });
});

/** A stand-in for the model: sometimes honest, sometimes inventing numbers, with a seeded random source. */
function flakyWriter(seed: number, lieRate: number): CardWriter & { calls: number } {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const w = {
    model: "test-model", calls: 0,
    async write(f: Facts): Promise<WriterResult> {
      w.calls++;
      const honest = fallbackCards(f);
      const cards = honest.map((c) => (rnd() < lieRate ? { ...c, body: `${c.body} That is £${Math.floor(rnd() * 900 + 100)}.37 more than ever, up ${Math.floor(rnd() * 90)}%.` } : c));
      return { cards, inputTokens: 1500, outputTokens: 400 };
    },
  };
  return w;
}

describe("the pipeline: 20 generations, zero ungrounded numbers, at least 3 cards each", () => {
  it("holds whatever the writer does", async () => {
    for (let run = 0; run < 20; run++) {
      const n = await narrate(facts, flakyWriter(run + 1, 0.4));
      expect(n.cards.length).toBeGreaterThanOrEqual(MIN_CARDS);
      expect(validateCards(n.cards, facts).dropped, `run ${run}`).toEqual([]);
      for (const c of n.cards) for (const fig of figuresIn(`${c.title} ${c.body}`)) expect(facts.facts.some((f) => f.display === fig), `${fig} in "${c.title}"`).toBe(true);
    }
  });
  it("retries once with the failure list, then falls back", async () => {
    const seen: (string | undefined)[] = [];
    const liar: CardWriter = { model: "liar", async write(f, failures) { seen.push(failures); return { cards: fallbackCards(f).map((c) => ({ ...c, title: "Up £999.99 on usual" })), inputTokens: 1, outputTokens: 1 }; } };
    const n = await narrate(facts, liar);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toContain("£999.99");
    expect(n.usedFallback).toBe(true);
    expect(n.cards.length).toBeGreaterThanOrEqual(MIN_CARDS);
    expect(n.dropped.length).toBeGreaterThan(0);
    expect(validateCards(n.cards, facts).dropped).toEqual([]);
  });
  it("uses the model's cards when they are grounded, and counts the tokens", async () => {
    const good: CardWriter = { model: "good", async write(f) { return { cards: fallbackCards(f), inputTokens: 1200, outputTokens: 300 }; } };
    const n = await narrate(facts, good);
    expect(n.usedFallback).toBe(false);
    expect(n.model).toBe("good");
    expect(n.inputTokens).toBe(1200);
    expect(n.dropped).toEqual([]);
  });
  it("survives a model that throws, and works with no model at all", async () => {
    const boom: CardWriter = { model: "boom", async write() { throw new Error("overloaded"); } };
    expect((await narrate(facts, boom)).usedFallback).toBe(true);
    const none = await narrate(facts, null);
    expect(none.model).toBe("template");
    expect(none.cards.length).toBeGreaterThanOrEqual(MIN_CARDS);
  });
  it("rejects cards that break the schema (e.g. a title over 70 characters)", async () => {
    const long: CardWriter = { model: "long", async write(f) { return { cards: [{ ...fallbackCards(f)[0]!, title: "x".repeat(90) }], inputTokens: 1, outputTokens: 1 }; } };
    const n = await narrate(facts, long);
    expect(n.cards.every((c) => c.title.length <= 70)).toBe(true);
  });
});
