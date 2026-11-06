"use client";
// The month's review (MC08, MC-50): shared by step 5 and the read-only review of a closed month. Everything is passed in; nothing is calculated here.
import { useQuery } from "@tanstack/react-query";
import { CategoryIcon, UI } from "@/lib/icons";
import { errorPct, monthName } from "@/lib/close/logic";
import type { CloseSummary, Snapshot } from "@/lib/close/types";
import type { ISODate } from "@/lib/dates";
import { formatGBP, pctOf } from "@/lib/money";
import { useCategoryTree } from "@/lib/queries/hooks";

export interface ReviewData {
  month: ISODate; partial: boolean; spent: number; income: number; kept: number; budget: number | null; status: "within" | "over" | null;
  everyday: number; usual: number | null; byL1: Record<string, number>; limits: { category_id: string; limit: number; actual: number }[];
  forecasts: { date: ISODate; point: number }[]; incomeSources: string[]; billsRegular: number | null; recurring: Record<string, { total: number; names: string[] }>;
}
export const fromSummary = (s: CloseSummary): ReviewData => ({
  month: s.month, partial: s.partial, spent: s.spent, income: s.income, kept: s.kept, budget: s.budget, status: s.budget_status, everyday: s.everyday, usual: s.usual_estimate,
  byL1: s.by_l1, limits: s.limits, forecasts: s.forecasts.map((f) => ({ date: f.date, point: f.point })), incomeSources: s.income_sources, billsRegular: s.bills_regular, recurring: s.recurring_l1 ?? {},
});
export const fromSnapshot = (sn: Snapshot): ReviewData => ({
  month: sn.month, partial: sn.usual_estimate === null && sn.forecasts.length === 0, spent: sn.spent, income: sn.income, kept: sn.kept, budget: sn.budget, status: sn.budget_status, everyday: sn.everyday,
  usual: sn.usual_estimate, byL1: sn.by_l1, limits: sn.limits, forecasts: sn.forecasts, incomeSources: [], billsRegular: null, recurring: {},
});

const whole = (p: number) => formatGBP(p, { whole: true });
const dayShort = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const list = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The AI summary arrives later and is inserted when it does; the review never waits for it (MC-50). */
function useSummaryText(month: ISODate, enabled: boolean, stored?: string | null) {
  return useQuery({
    queryKey: ["close", "summary-text", month], enabled: enabled && !stored, staleTime: 5 * 60_000, retry: 0,
    queryFn: async () => { const r = await fetch(`/api/close/summary?month=${month}`); if (!r.ok) return null; return ((await r.json()) as { text: string | null }).text; },
  });
}

export function ReviewBody({ d, ai = true, storedSummary }: { d: ReviewData; ai?: boolean; storedSummary?: string | null }) {
  const { tree } = useCategoryTree();
  const text = useSummaryText(d.month, ai, storedSummary);
  const summary = storedSummary ?? text.data ?? null;
  const name = monthName(d.month);
  const diff = d.budget === null ? null : d.budget - d.spent;
  const pct = d.budget ? Math.round(pctOf(d.spent, d.budget)) : null;
  const rows = Object.entries(d.byL1).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const scale = Math.max(1, ...rows.map(([, v]) => v), ...d.limits.map((l) => l.limit));
  const limitOf = new Map(d.limits.map((l) => [l.category_id, l]));
  const evPct = d.usual && !d.partial ? Math.round(((d.everyday - d.usual) / d.usual) * 100) : null;
  const sources = d.incomeSources.slice(0, 2).map((s) => s.toLowerCase());
  const f0 = d.forecasts[0];
  return (
    <div data-testid="close-review">
      <div className="mc-item" style={{ marginTop: 14 }} data-testid="review-spent">
        <div className="row-between"><span className="sub">Spent in {name}</span>
          {d.status === "within" && <span className="mc-pill pos" data-testid="review-status"><UI.Check size={12} strokeWidth={3} aria-hidden />Within budget</span>}
          {d.status === "over" && <span className="mc-pill cau" data-testid="review-status">Over budget</span>}</div>
        <div className="mc-big" style={{ marginTop: 6 }} data-testid="review-spent-amount">{formatGBP(d.spent)}</div>
        {d.budget !== null && diff !== null ? (
          <>
            <div className="mc-meter" aria-hidden><i className={diff < 0 ? "over" : ""} style={{ width: `${Math.min(100, Math.max(0, pctOf(d.spent, d.budget)))}%` }} /></div>
            <div className="row-between"><span className="sub" data-testid="review-pct">{pct}% of {whole(d.budget)}</span>
              <span className={`sub ${diff >= 0 ? "pos" : "cau"}`} data-testid="review-diff">{formatGBP(Math.abs(diff))} {diff >= 0 ? "under" : "over"}</span></div>
          </>
        ) : <p className="sub" style={{ marginTop: 8 }}>{d.usual !== null ? `${formatGBP(d.spent)} against your usual of about ${whole(d.usual)}` : "No budget was set for this month."}</p>}
      </div>
      <div className="mc-tiles">
        <div data-testid="tile-in"><div className="k">Money in</div><div className="v">{whole(d.income)}</div><div className="s">{sources.length ? list(sources) : " "}</div></div>
        {d.income > 0 ? <div data-testid="tile-kept"><div className="k">Kept</div><div className="v">{whole(d.kept)}</div><div className="s">{Math.round(pctOf(d.kept, d.income))}% of money in</div></div> : <div />}
        {evPct !== null ? <div data-testid="tile-everyday"><div className="k">Everyday</div><div className="v">{whole(d.everyday)}</div><div className="s">{evPct >= 0 ? "+" : "−"}{Math.abs(evPct)}% vs usual</div></div> : <div data-testid="tile-everyday"><div className="k">Everyday</div><div className="v">{whole(d.everyday)}</div><div className="s"> </div></div>}
      </div>
      {summary && (
        <div className="mc-item" data-testid="review-summary">
          <div className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center" }}><UI.Sparkles size={14} aria-hidden />Summary</div>
          <p className="callout" style={{ marginTop: 8, lineHeight: 1.45 }}>{summary}</p>
        </div>
      )}
      <div className="row-between" style={{ margin: "24px 4px 8px" }}><span className="eyebrow">By category</span>{d.billsRegular !== null && <span className="sub" data-testid="bills-regular">Bills &amp; regular {whole(d.billsRegular)}</span>}</div>
      <div className="card" style={{ padding: "4px 16px" }} data-testid="review-categories">
        {rows.map(([id, v]) => {
          const c = tree.byId.get(id);
          const lim = limitOf.get(id);
          const rec = d.recurring[id];
          const fixedOnly = !!rec && rec.total >= v;
          return (
            <div className="cbar-row" key={id} data-testid="review-category" data-category={c?.name}>
              <div className="tile"><CategoryIcon name={c?.icon} size={16} /></div>
              <div className="cbar-name">{c?.name ?? "Category"}</div>
              <div className="cbar-amt num">{formatGBP(v)}</div>
              {fixedOnly ? <div className="sub" style={{ gridColumn: "2 / 4", fontSize: "var(--t-caption)" }}>{list(rec.names.map((n, i) => (i ? n.toLowerCase() : n))).replace(/ & mortgage/i, "")}</div> : (
                <>
                  <div className={`cbar-track ${lim && v > lim.limit ? "over" : ""}`} aria-hidden><div className="b" style={{ width: `${(v / scale) * 100}%`, background: lim && v > lim.limit ? "var(--caution)" : undefined }} />{lim && <div className="n" style={{ left: `${(lim.limit / scale) * 100}%` }} />}</div>
                  {lim && <div className="sub" style={{ gridColumn: "2 / 4", fontSize: "var(--t-caption)", color: v > lim.limit ? "var(--caution)" : "var(--ink-3)" }}>{v > lim.limit ? `${formatGBP(v - lim.limit)} over its ${whole(lim.limit)} limit` : `${formatGBP(lim.limit - v)} left of ${whole(lim.limit)}`}</div>}
                </>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="sub" style={{ padding: "14px 0" }}>No spending recorded in {name}.</p>}
      </div>
      {f0 && !d.partial && d.forecasts.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "24px 4px 8px" }}>How good was the forecast?</div>
          <div className="mc-item" style={{ marginTop: 0 }} data-testid="review-forecast">
            <div className="headline" style={{ lineHeight: 1.3 }}>On {dayShort(f0.date)} it said {formatGBP(f0.point)}, {errorPct(f0.point, d.spent).replace(/^[−+]/, "")} from the final figure</div>
            <div className="mc-fc">{d.forecasts.map((f) => (<span key={f.date} style={{ display: "contents" }}><span>On {dayShort(f.date)}</span><span>{formatGBP(f.point)}</span><span data-testid="forecast-error">{errorPct(f.point, d.spent)}</span></span>))}</div>
            <p className="sub" style={{ marginTop: 14, lineHeight: 1.45 }}>Forecast on each date against the final {formatGBP(d.spent)}. Closing the month locks these results in for the forecast’s own tuning.</p>
          </div>
        </>
      )}
    </div>
  );
}
