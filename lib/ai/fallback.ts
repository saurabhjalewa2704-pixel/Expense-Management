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

/** Template cards for a trip (TRIP-08), straight from its facts, so the card is grounded by construction. Two to four, most useful first. */
export function fallbackTripCards(facts: Facts): Card[] {
  const by = new Map(facts.facts.map((f) => [f.key, f]));
  const get = (k: string): Fact | undefined => by.get(k);
  const name = get("trip_name")?.display ?? "the trip";
  const phase = get("trip_phase")?.display;
  const link = facts.trip_id ? { kind: "screen" as const, id: `/trips/${facts.trip_id}` } : undefined;
  const cards: Card[] = [];
  const add = (c: Omit<Card, "viz" | "rank"> & { viz?: Card["viz"] }) => cards.push({ viz: "none", link, ...c, rank: cards.length + 1 });

  // pace against the budget
  const left = get("left"), dir = get("left_dir"), budget = get("budget");
  if (budget && left && dir && phase === "during") {
    const gap = get("projected_gap"), pdir = get("projected_dir"), per = get("actual_per_day"), plan = get("plan_per_day"), allow = get("allowance");
    if (gap && pdir) {
      const under = pdir.display === "under";
      add({
        key: `trip_pace:${facts.trip_id}`, type: "trip_pace", severity: under ? "positive" : "caution",
        title: clip(under ? `At this pace you’ll finish about ${gap.display} under budget` : `At this pace you’ll finish about ${gap.display} over budget`, 70),
        body: clip(`${per && plan ? `You’re spending ${per.display} a day on the trip against the ${plan.display} you planned.` : `${get("spent")?.display ?? ""} spent of ${budget.display}.`}${allow ? ` That leaves ${allow.display} a day for the rest of it.` : ""}`, 220),
        metric: { fact_key: "spent", delta_fact_key: "budget" }, viz: "bar_compare",
      });
    }
  } else if (budget && left && dir && phase === "after") {
    add({
      key: `trip_pace:${facts.trip_id}`, type: "trip_pace", severity: dir.display === "under" ? "positive" : "caution",
      title: clip(`${name} finished ${left.display} ${dir.display} budget`, 70), body: clip(`${get("spent")?.display ?? ""} spent against a budget of ${budget.display}.`, 220),
      metric: { fact_key: "spent", delta_fact_key: "budget" }, viz: "bar_compare",
    });
  } else if (phase !== "before" && get("actual_per_day")) {
    add({ key: `trip_pace:${facts.trip_id}`, type: "trip_pace", severity: "info", title: clip(`You’re averaging ${get("actual_per_day")!.display} a day on the trip`, 70), body: clip(`${get("on_trip")?.display ?? ""} spent during ${name}, with ${get("booked")?.display ?? "nothing"} booked before.`, 220) });
  }

  // the biggest category
  const top = facts.facts.find((f) => /^mix:.*:pct$/.test(f.key));
  if (top) {
    const s = top.key.split(":")[1]!;
    const nm = get(`mix:${s}:name`)?.display ?? "", tot = get(`mix:${s}:total`), cnt = get(`mix:${s}:count`);
    add({
      key: `trip_mix:${facts.trip_id}`, type: "trip_mix", severity: "info", title: clip(`${nm} is ${top.display} of the trip`, 70),
      body: clip(`${tot?.display ?? ""}${cnt ? ` across ${cnt.display} expense${cnt.display === "1" ? "" : "s"}` : ""} on ${name}.`, 220),
      metric: tot ? { fact_key: tot.key } : undefined, link: facts.entities.find((e) => e.name === nm) ? link : link,
    });
  }

  // one stop against another
  const pct = get("stop_cmp_pct"), hi = get("stop_hi"), lo = get("stop_lo");
  if (pct && hi && lo) {
    const hiPer = get(`stop:${slugOf(hi.display)}:perday`), loPer = get(`stop:${slugOf(lo.display)}:perday`);
    const nohotel = get("stop_lo_nohotel")?.display === "no hotel";
    add({
      key: `trip_stop:${facts.trip_id}`, type: "trip_stop", severity: "info", title: clip(`${hi.display} is costing ${pct.display} more a day than ${lo.display}`, 70),
      body: clip(`${nohotel ? `With no hotel to pay for, ${lo.display}` : lo.display} came to ${loPer?.display ?? ""} a day. ${hi.display} is ${hiPer?.display ?? ""} a day so far.`, 220),
    });
  }

  // the biggest single expense
  const bigT = get("big_total"), bigP = get("big_payee"), bigD = get("big_day"), bigO = get("big_orig");
  if (bigT && bigP && bigD) {
    add({
      key: `trip_big:${facts.trip_id}`, type: "trip_big", severity: "info", title: clip(`${bigP.display} was the biggest expense: ${bigT.display}`, 70),
      body: clip(`${bigT.display}${bigO ? ` (${bigO.display})` : ""} on ${bigD.display}, the largest single expense on ${name}.`, 220), metric: { fact_key: "big_total" },
    });
  }

  // against earlier trips
  const cmp = get("cmp_perday");
  if (cmp) {
    const since = get("cmp_since_name"), sincePer = get("cmp_since_perday"), prev = get("cmp_prev_name"), prevPer = get("cmp_prev_perday");
    add(since && sincePer ? {
      key: `trip_compare:${facts.trip_id}`, type: "trip_compare", severity: "info", title: clip(`Your priciest trip per day since ${since.display}`, 70),
      body: clip(`${name} is running at ${cmp.display} a day on the trip. ${since.display} came to ${sincePer.display} a day.`, 220), metric: { fact_key: "cmp_perday", delta_fact_key: "cmp_since_perday" }, viz: "bar_compare",
    } : {
      key: `trip_compare:${facts.trip_id}`, type: "trip_compare", severity: "caution", title: clip("Your priciest trip per day so far", 70),
      body: clip(`${name} is at ${cmp.display} a day, ahead of ${prev?.display ?? "your earlier trips"}${prevPer ? ` at ${prevPer.display} a day` : ""}.`, 220), metric: prevPer ? { fact_key: "cmp_perday", delta_fact_key: "cmp_prev_perday" } : undefined, viz: prevPer ? "bar_compare" : "none",
    });
  }

  // card fees
  const fee = get("fx_fee_total"), rate = get("fx_fee_rate");
  if (fee && rate) add({ key: `trip_fx:${facts.trip_id}`, type: "trip_fx", severity: "caution", title: clip(`Card fees have cost ${fee.display} so far`, 70), body: clip(`A ${rate.display} foreign fee on spending abroad on ${name}. A card with no foreign fees would save that.`, 220), metric: { fact_key: "fx_fee_total" } });

  return cards.slice(0, 4).map((c, i) => ({ ...c, rank: i + 1 }));
}

const slugOf = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
