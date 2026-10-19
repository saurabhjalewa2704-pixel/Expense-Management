"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TxnItem } from "@/components/activity/txn-row";
import { groupByDay } from "@/components/accounts/account-detail";
import { ChartCard } from "@/components/charts/chart-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { PageHeader } from "@/components/ui/page-header";
import { average, type TrendBar } from "@/lib/analytics";
import { dayHeader, diffDays, formatDayMonth, formatMonthYear, monthEnd, monthStart } from "@/lib/dates";
import { CategoryIcon } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useActivity, useCategoryMonthly, useCategoryTree, useSpendByCategory, useToday, useTopPayees } from "@/lib/queries/hooks";

/** AN-07: opened from any category: 12 months, average ticket, frequency, top payees, sub-category split, transactions. */
export function CategoryDeepDive({ id }: { id: string }) {
  const today = useToday();
  const sp = useSearchParams();
  const from = sp.get("from") ?? monthStart(today);
  const to = sp.get("to") ?? monthEnd(today);
  const { tree } = useCategoryTree();
  const cat = tree.byId.get(id);
  const ids = cat ? [cat.id, ...tree.children(cat.id).map((c) => c.id)] : [id];
  const monthly = useCategoryMonthly(id, 12);
  const split = useSpendByCategory(from, to, id);
  const payees = useTopPayees(from, to, 5, id);
  const activity = useActivity({ categoryIds: ids, from, to });

  const rows = split.data ?? [];
  const total = rows.reduce((s, r) => s + r.total_pence, 0);
  const count = rows.reduce((s, r) => s + r.txn_count, 0);
  const days = Math.max(1, diffDays(to < today ? to : today, from) + 1);
  const thisMonth = monthStart(today);
  const bars: TrendBar[] = (monthly.data ?? []).map((m) => ({ month: m.month, spend: m.total_pence, income: 0, projectedExtra: 0, isCurrent: m.month === thisMonth }));
  const avg = average(bars.filter((b) => !b.isCurrent && b.spend > 0).map((b) => b.spend));
  const groups = groupByDay(activity.rows.slice(0, 15));
  const filterHref = (cid: string) => `/activity?categories=${cid}&from=${from}&to=${to}`;

  if (!cat) return <div className="scroll"><PageHeader title="Category" back="/analytics" backLabel="Analytics" /></div>;
  return (
    <div className="scroll">
      <PageHeader title={cat.name} back="/analytics" backLabel="Analytics" />
      <div className="sub" style={{ marginTop: 6 }}>{formatDayMonth(from)} – {formatDayMonth(to)}</div>
      <div className="analytics-grid" style={{ marginTop: 14 }}>
        <div className="card" data-testid="deep-stats">
          <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <div><div className="sub">Spent</div><div className="num headline" style={{ marginTop: 4 }}>{formatGBP(total)}</div></div>
            <div><div className="sub">Average ticket</div><div className="num headline" style={{ marginTop: 4 }} data-testid="avg-ticket">{count ? formatGBP(Math.round(total / count)) : "—"}</div></div>
            <div><div className="sub">Frequency</div><div className="num headline" style={{ marginTop: 4 }}>{count} <span className="sub" style={{ fontWeight: 400 }}>· {count ? (count / (days / 7)).toFixed(1) : "0"}/wk</span></div></div>
          </div>
        </div>
        <ChartCard testId="deep-trend" loading={monthly.isLoading} empty={bars.every((b) => b.spend === 0)}
          finding={avg ? `${cat.name} averages ${formatGBP(avg, { whole: true })} a month` : `${cat.name} by month`} sub="Monthly spend, last 12 months"
          table={{ columns: ["Month", "Spend"], rows: bars.map((b) => [formatMonthYear(b.month), formatGBP(b.spend)]) }}>
          <TrendChart bars={bars} avg={avg} showIncome={false} />
        </ChartCard>
      </div>

      {rows.length > 1 && (
        <>
          <div className="section-h"><h2>Sub-categories</h2></div>
          <div className="list" data-testid="subcategory-split">
            {rows.map((r) => (
              <Link key={r.category_id} href={filterHref(r.category_id)} className="row">
                <div className="tile"><CategoryIcon name={r.icon} size={20} /></div>
                <div className="row-main"><div className="row-t">{r.category_id === id ? `${cat.name} (general)` : r.name}</div><div className="row-s">{r.txn_count} transaction{r.txn_count === 1 ? "" : "s"} · {total ? Math.round((r.total_pence * 100) / total) : 0}%</div></div>
                <div className="amt">{formatGBP(r.total_pence)}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      {(payees.data ?? []).length > 0 && (
        <>
          <div className="section-h"><h2>Top payees</h2></div>
          <div className="list">
            {(payees.data ?? []).map((t) => (
              <Link key={t.payee_id} href={`/activity?payee=${t.payee_id}&from=${from}&to=${to}`} className="row">
                <div className="row-main"><div className="row-t">{t.name}</div><div className="row-s">{t.visits} visit{t.visits === 1 ? "" : "s"} · avg {formatGBP(t.avg_pence)}</div></div>
                <div className="amt">{formatGBP(t.total_pence)}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-h"><h2>Transactions</h2><Link className="link" href={filterHref(id)}>See all</Link></div>
      {groups.map((g) => (
        <div key={g.day}><div className="day-h"><b>{dayHeader(g.day, today)}</b></div><div className="list">{g.rows.map((r) => <TxnItem key={r.client_id} row={r} />)}</div></div>
      ))}
      {!activity.isLoading && groups.length === 0 && <p className="sub" style={{ margin: "0 4px" }}>No transactions in this period.</p>}
    </div>
  );
}
