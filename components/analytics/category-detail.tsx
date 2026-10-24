"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { MonthlyBars, type MonthlyBar } from "@/components/charts/monthly-bars";
import { ShareBar } from "@/components/charts/share-bar";
import { SubcategoryRow, rowScale } from "@/components/charts/subcategory-row";
import { PeriodStepper } from "@/components/analytics/period-control";
import { Sheet } from "@/components/ui/sheet";
import { averageTicket, deltaFlag, leafLabel } from "@/lib/analytics";
import { formatMonthYear, monthStart } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP, medianPence, pctChange, pctOf } from "@/lib/money";
import { periodQuery, useUrlPeriod } from "@/lib/period-url";
import { resolvePeriod, stepPeriod } from "@/lib/periods";
import { useCategoryMonthly, useCategoryRemaining, useCategoryTree, useSpendByCategory, useToday, useTopPlaces } from "@/lib/queries/hooks";

const isAre = (name: string) => (/s$/.test(name) ? "are" : "is");

function shareFinding(name: string, share: number): string {
  if (share >= 50) return `${name} ${isAre(name)} more than half of it`;
  if (share >= 40) return `${name} ${isAre(name)} almost half of it`;
  if (share >= 30) return `${name} ${isAre(name)} about a third of it`;
  return `${name} ${isAre(name)} the biggest part, at ${share}%`;
}

/**
 * AN-07 (a category) and AN-07b (a sub-category): the same template. A category adds the split by sub-category and
 * trend chips; a sub-category has neither. Both follow the Analytics period, carried in the URL as `?p=`.
 */
export function CategoryDetail({ id, level }: { id: string; level: "category" | "sub" }) {
  const today = useToday();
  const sp = useSearchParams();
  const [sel, setSel] = useUrlPeriod(today);
  const p = resolvePeriod(sel, today);
  const { tree } = useCategoryTree();
  const cat = tree.byId.get(id);
  const parent = cat?.parent_id ? tree.byId.get(cat.parent_id) : undefined;
  const isSub = level === "sub";
  // spend assigned straight to a parent (opened from an "Other ‹parent›" row) is a sub-category of its own, with the parent's id
  const direct = isSub && !cat?.parent_id;
  const parentOfRows = isSub ? (direct ? id : cat?.parent_id ?? null) : id;
  const group = isSub ? parent ?? (direct ? cat : undefined) : cat;
  const [chip, setChip] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const all = useSpendByCategory(p.from, p.to, null);                            // L1 totals: this category's row and the overall total
  const prevAll = useSpendByCategory(p.prevFrom, p.prevTo, null);
  const leaves = useSpendByCategory(p.from, p.to, parentOfRows, false, "leaf");  // the category's sub-categories as assigned
  const trendId = chip ?? id;
  const withKids = !isSub && !chip;   // a category's own trend includes its sub-categories; a chip or a sub-category is just itself
  const monthly = useCategoryMonthly(trendId, 6, withKids);
  const projecting = p.isCurrent && p.kind === "month";
  const remaining = useCategoryRemaining(trendId, p.to, withKids, projecting);
  const places = useTopPlaces(p.from, p.to, isSub ? 5 : 3, id, isSub ? false : true);

  const allRows = all.data ?? [];
  const overall = allRows.reduce((s, r) => s + r.total_pence, 0);
  const leafRows = leaves.data ?? [];
  const row = isSub ? leafRows.find((r) => r.category_id === id) : allRows.find((r) => r.category_id === id);
  const prevRow = isSub ? undefined : (prevAll.data ?? []).find((r) => r.category_id === id);
  const total = row?.total_pence ?? 0, count = row?.txn_count ?? 0;
  const usual = p.kind === "month" ? row?.norm_pence ?? null : null;
  const flag = deltaFlag(total, usual);
  const name = !cat ? "" : isSub ? leafLabel({ name: cat.name, is_parent_direct: !!direct }) : cat.name;
  const backHref = isSub && sp.get("b") ? `/analytics/category/${sp.get("b")}?${periodQuery(sel)}` : `/analytics?${periodQuery(sel)}`;
  const backLabel = isSub && sp.get("b") ? tree.byId.get(sp.get("b")!)?.name ?? "Back" : "Analytics";
  const activityHref = `/activity?categories=${id}&from=${p.from}&to=${p.to}`;
  const loading = all.isLoading || leaves.isLoading;

  // the comparison line under the total
  let cmp: { tone: "cau" | "pos" | ""; text: string } | null = null;
  if (row && usual && usual > 0) {
    const pct = pctChange(total, usual) ?? 0;
    cmp = flag ? { tone: "cau", text: `${pct}% above your usual ${formatGBP(usual, { whole: true })} by this point` }
      : pct < -20 ? { tone: "pos", text: `${Math.abs(pct)}% below your usual ${formatGBP(usual, { whole: true })} by this point` }
      : { tone: "", text: `In line with your usual ${formatGBP(usual, { whole: true })} by this point` };
  } else if (row && !isSub && prevRow && prevRow.total_pence > 0 && p.kind !== "month") {
    const pct = pctChange(total, prevRow.total_pence) ?? 0;
    cmp = { tone: "", text: `${Math.abs(pct)}% ${pct >= 0 ? "above" : "below"} ${p.prevLabel} to the same point` };
  }

  // the six-month trend; this month's bar is the actual so far plus the usual rest of the month
  const thisMonth = monthStart(today);
  const bars: MonthlyBar[] = (monthly.data ?? []).map((m) => ({
    month: m.month, spend: m.total_pence, isCurrent: m.month === thisMonth,
    projectedExtra: m.month === thisMonth && projecting ? remaining.data ?? 0 : 0,
  }));
  const cur = bars.find((b) => b.isCurrent);
  const earlier = bars.filter((b) => !b.isCurrent).map((b) => b.spend);
  const projected = cur ? cur.spend + cur.projectedExtra : 0;
  const trendFinding = !cur || !projecting || earlier.length === 0 || remaining.data == null ? `${chip ? tree.byId.get(chip)?.name : name} by month`
    : projected > Math.max(...earlier) ? "On course for your biggest month in six"
    : projected < Math.min(...earlier) ? "On course for your smallest month in six"
    : `On course for ${formatGBP(projected, { whole: true })}, in line with the last six months (median ${formatGBP(medianPence(earlier), { whole: true })})`;

  const subCaption = (r: (typeof leafRows)[number]) => `${r.visits} visit${r.visits === 1 ? "" : "s"} · avg ${formatGBP(averageTicket(r.total_pence, r.txn_count))}`;
  const ranked = [...leafRows].sort((a, b) => b.total_pence - a.total_pence);
  const top = ranked[0];
  const chips = ranked.filter((r) => !r.is_parent_direct);
  const detailHref = (r: { category_id: string }) => `/analytics/subcategory/${r.category_id}?${periodQuery(sel)}&b=${id}`;
  const back = <Link className="back" href={backHref}><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />{backLabel}</Link>;

  if (!cat) return <div className="scroll"><div className="navbar">{back}</div></div>;
  return (
    <div className="scroll" data-testid={isSub ? "subcategory-detail" : "category-detail"}>
      <div className="navbar" style={{ justifyContent: "space-between" }}>{back}</div>
      <h1 className="large-title" style={{ fontSize: "var(--t-title)" }}>{name}</h1>
      <PeriodStepper value={sel} today={today} onChange={setSel} />

      {!loading && !row ? (
        <div className="card" style={{ marginTop: 14, textAlign: "center", padding: "28px 16px" }} data-testid="detail-empty">
          <p className="sub">No {name} spending in {p.label}</p>
          <button className="link" style={{ marginTop: 10 }} onClick={() => setSel(stepPeriod(sel, -1))}>See {resolvePeriod(stepPeriod(sel, -1), today).label}</button>
        </div>
      ) : (
        <>
          <div className="detail-hero">
            <div className="tile"><CategoryIcon name={cat.icon} size={22} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="cap">{isSub ? `${name} · ${group?.name ?? ""}` : name} · {p.kind === "month" ? `${Number(p.from.slice(8))}–${Number(p.to.slice(8))} ${formatMonthYear(p.to).split(" ")[0]}` : p.label}</div>
              <div className="big num" data-testid="detail-total">{loading ? "—" : formatGBP(total)}</div>
            </div>
          </div>
          {cmp && <div className="cmp-line" data-testid="detail-cmp"><i className={cmp.tone} />{cmp.text}</div>}

          <div className="stat-tiles" data-testid="detail-stats">
            <div className="stat-tile"><b className="num">{count}</b><span>Transactions</span></div>
            <div className="stat-tile"><b className="num" data-testid="avg-ticket">{count ? formatGBP(averageTicket(total, count)) : "—"}</b><span>Average per transaction</span></div>
            <div className="stat-tile"><b className="num">{pctOf(total, overall)}%</b><span>of all spend</span></div>
          </div>

          {!isSub && ranked.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <ChartCard testId="chart-split" finding={top ? shareFinding(leafLabel(top), pctOf(top.total_pence, total)) : "Split by sub-category"}
                sub={`Split by sub-category${usual != null ? ` · marker = usual by day ${p.elapsed}` : ""}`}
                table={{ columns: ["Sub-category", "Spend", "Share"], rows: ranked.map((r) => [leafLabel(r), formatGBP(r.total_pence), `${pctOf(r.total_pence, total)}%`]) }}>
                <ShareBar parts={ranked.map((r) => ({ key: r.category_id, label: leafLabel(r), pence: r.total_pence }))} />
                <div data-testid="subcategory-split">
                  {ranked.map((r) => <SubcategoryRow key={r.category_id} row={r} caption={subCaption(r)} scale={rowScale(ranked, p.kind === "month")} showUsual={p.kind === "month"} href={detailHref(r)} total={total} />)}
                </div>
              </ChartCard>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <ChartCard testId="chart-monthly" loading={monthly.isLoading} empty={bars.every((b) => b.spend === 0 && b.projectedExtra === 0)}
              finding={trendFinding} sub={`${chip ? tree.byId.get(chip)?.name : name} by month${projecting && cur ? " · hatched = projected to month end" : ""}`}
              table={{ columns: ["Month", "Spend"], rows: bars.map((b) => [b.month.slice(0, 7), formatGBP(b.spend + b.projectedExtra) + (b.projectedExtra ? " (projected)" : "")]) }}>
              {!isSub && chips.length > 1 && (
                <div className="chip-row" role="group" aria-label="Show a sub-category" data-testid="trend-chips">
                  <button className={`chip plain ${chip === null ? "sel" : ""}`} aria-pressed={chip === null} onClick={() => setChip(null)}>All</button>
                  {chips.slice(0, 3).map((r) => <button key={r.category_id} className={`chip plain ${chip === r.category_id ? "sel" : ""}`} aria-pressed={chip === r.category_id} onClick={() => setChip(r.category_id)}>{r.name.split(/\s|&/)[0]}</button>)}
                  {chips.length > 3 && <button className={`chip plain ${chip && !chips.slice(0, 3).some((r) => r.category_id === chip) ? "sel" : ""}`} onClick={() => setMore(true)}>More…</button>}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <MonthlyBars bars={bars} flagged={!!flag && !chip} ariaLabel={`${name} by month, last six months`} />
              </div>
            </ChartCard>
          </div>

          {(places.data ?? []).length > 0 && (
            <>
              <div className="section-h"><h2>Top places</h2><Link className="link" href={activityHref}>All {count}</Link></div>
              <div className="list" data-testid="top-places">
                {(places.data ?? []).map((t) => (
                  <Link key={t.payee_id} href={`/activity?payee=${t.payee_id}&categories=${id}&from=${p.from}&to=${p.to}`} className="row">
                    <div className="row-main"><div className="row-t">{t.name}</div><div className="row-s">{t.category_name}{t.category_name ? " · " : ""}{t.visits} visit{t.visits === 1 ? "" : "s"}</div></div>
                    <div className="amt">{formatGBP(t.total_pence)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Sheet open={more} onOpenChange={setMore} title="Sub-categories">
        <div className="vaul-body">
          <div className="sheet-head"><button className="txt" onClick={() => setMore(false)}>Close</button><span className="t">Sub-categories</span><span /></div>
          <div className="list">
            {chips.map((r) => (
              <button key={r.category_id} className="row" aria-pressed={chip === r.category_id} onClick={() => { setChip(r.category_id); setMore(false); }}>
                <div className="row-main"><div className="row-t">{r.name}</div></div><div className="amt">{formatGBP(r.total_pence)}</div>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
