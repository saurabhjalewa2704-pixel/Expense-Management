// Deterministic cards rendered straight from the facts, used when there is no model, the token cap is reached, or the
// model's cards fail validation twice. Every figure is a fact's own `display`, so these are grounded by construction
// (and still go through the validator in tests).
import type { Card, Fact, Facts } from "./types";

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function fallbackCards(facts: Facts): Card[] {
  const by = new Map(facts.facts.map((f) => [f.key, f]));
  const get = (k: string): Fact | undefined => by.get(k);
  const entity = (name: string) => facts.entities.find((e) => e.kind === "category" && e.name === name);
  const cards: Card[] = [];
  const add = (c: Omit<Card, "viz" | "rank"> & { viz?: Card["viz"] }) => cards.push({ viz: "none", ...c, rank: cards.length + 1 });

  // pace
  const spend = get("spend_mtd"), prev = get("spend_prev_same_point"), gap = get("pace_gap"), dir = get("pace_dir"), prevName = get("prev_month_name")?.display ?? "last month";
  if (spend && prev && gap && dir && dir.display !== "level") {
    const under = dir.display === "under";
    const projected = get("projected_spend");
    add({
      key: `pace:${facts.period.to.slice(0, 7)}`, type: "pace", severity: under ? "positive" : "caution",
      title: clip(`You're ${gap.display} ${dir.display} ${prevName}'s pace`, 70),
      body: clip(`${spend.display} spent so far this month, against ${prev.display} at the same point in ${prevName}.${projected ? ` On track to spend about ${projected.display} this month.` : ""}`, 220),
      metric: { fact_key: "spend_mtd", delta_fact_key: "spend_prev_same_point" }, viz: "bar_compare", link: { kind: "screen", id: "/analytics" },
    });
  }

  // anomalies and wins, per category
  for (const f of facts.facts.filter((x) => x.key.endsWith(":pct_over")).slice(0, 2)) {
    const slug = f.key.split(":")[1]!;
    const total = get(`cat:${slug}:total`), usual = get(`cat:${slug}:usual`), name = f.label;
    if (!total || !usual) continue;
    const e = entity(name);
    add({
      key: `anomaly:${slug}:${facts.period.to.slice(0, 7)}`, type: "anomaly", severity: "caution",
      title: clip(`${name} is running ${f.display} above your usual`, 70),
      body: clip(`${total.display} so far, against about ${usual.display} by this point in a typical period.`, 220),
      metric: { fact_key: `cat:${slug}:total`, delta_fact_key: `cat:${slug}:usual` }, viz: "bar_compare", link: e ? { kind: "category", id: e.id } : undefined,
    });
  }
  for (const f of facts.facts.filter((x) => x.key.endsWith(":low")).slice(0, 1)) {
    const slug = f.key.split(":")[1]!;
    const total = get(`cat:${slug}:total`);
    if (!total) continue;
    const e = entity(f.label);
    add({
      key: `win:${slug}:${facts.period.to.slice(0, 7)}`, type: "win", severity: "positive",
      title: clip(`${f.label} is your lowest in ${f.display} months: ${total.display}`, 70),
      body: clip(`${total.display} so far, less than in any of the previous ${f.display} comparable periods.`, 220),
      metric: { fact_key: `cat:${slug}:total` }, link: e ? { kind: "category", id: e.id } : undefined,
    });
  }

  // a category rising for several months
  for (const f of facts.facts.filter((x) => x.key.endsWith(":trend_len")).slice(0, 1)) {
    const slug = f.key.split(":")[1]!;
    const first = get(`cat:${slug}:trend_first`), last = get(`cat:${slug}:trend_last`);
    if (!first || !last) continue;
    const e = entity(f.label.replace(/ rising$/, ""));
    add({
      key: `trend:${slug}:${facts.period.to.slice(0, 7)}`, type: "trend", severity: "info",
      title: clip(`${f.label.replace(/ rising$/, "")} has risen for ${f.display} months in a row`, 70),
      body: clip(`From ${first.display} to ${last.display} a month.`, 220),
      metric: { fact_key: `cat:${slug}:trend_last`, delta_fact_key: `cat:${slug}:trend_first` }, viz: "bar_compare", link: e ? { kind: "category", id: e.id } : undefined,
    });
  }

  // subscriptions
  const sub = get("streaming_now"), subDelta = get("streaming_delta"), subSince = get("streaming_since");
  if (sub && subDelta) {
    add({
      key: `subscription:streaming:${facts.period.to.slice(0, 7)}`, type: "subscription", severity: "info",
      title: clip(`Streaming & apps now total ${sub.display} a month`, 70),
      body: clip(`Up ${subDelta.display}${subSince ? ` since ${subSince.label}` : " on three months ago"}.`, 220),
      metric: { fact_key: "streaming_now" }, link: entity("Streaming & apps") ? { kind: "category", id: entity("Streaming & apps")!.id } : undefined,
    });
  }

  // first-time payees
  for (const f of facts.facts.filter((x) => x.key.startsWith("new:")).slice(0, 1)) {
    const payee = facts.entities.find((e) => e.kind === "payee" && e.name === f.label);
    add({
      key: `new_payee:${f.key.split(":")[1]}`, type: "new_payee", severity: "info",
      title: clip(`First time at ${f.label}: ${f.display}`, 70),
      body: clip(`You paid ${f.label} ${f.display}. It's the first time they appear in your history.`, 220),
      metric: { fact_key: f.key }, link: payee ? { kind: "payee", id: payee.id } : undefined,
    });
  }

  if (cards.length === 0) {
    add({ key: `info:start:${facts.generated_on}`, type: "suggestion", severity: "info", title: "Keep logging and patterns will appear", body: "Insights need a few weeks of entries to say anything useful. Log what you spend and they will start to appear here.", link: { kind: "screen", id: "/activity" } });
  }
  return cards.slice(0, 6).map((c, i) => ({ ...c, rank: i + 1 }));
}
