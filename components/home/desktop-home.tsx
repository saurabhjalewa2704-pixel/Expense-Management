"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryBars } from "@/components/charts/category-bars";
import { BillsCard } from "@/components/home/bills-card";
import { PaceChart } from "@/components/charts/pace-chart";
import { Figure } from "@/components/money";
import { InsightCard } from "@/components/insights/insight-card";
import { recentWhen } from "@/components/activity/txn-row";
import { useQuickAdd } from "@/components/capture/quick-add";
import { categoryFinding, paceFinding } from "@/lib/analytics";
import { rowSubtitle, rowTitle } from "@/lib/categories";
import { addMonths, formatLong, formatMonth, formatMonthYear, monthStart } from "@/lib/dates";
import { CategoryIcon, UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { resolvePeriod, type PeriodKind } from "@/lib/periods";
import type { Category } from "@/lib/types";
import { useCashFlow, useCategories, useDailySpend, usePace, useProfile, useRecent, useSpendByCategory, useToday } from "@/lib/queries/hooks";
import { useAnimatedNumber } from "@/lib/use-animated-number";
import { rowAmount } from "@/components/activity/txn-row";
import { useMemo } from "react";

const NO_CATEGORIES: Category[] = [];

/** S10 (≥1024px): hero and equation, the pace chart, categories, a recent-activity table and an insights rail (WEB-02). */
export function DesktopHome() {
  const today = useToday();
  const router = useRouter();
  const { open } = useQuickAdd();
  const { data: profile } = useProfile();
  const [kind, setKind] = useState<Extract<PeriodKind, "month" | "quarter" | "year">>("month");
  const [q, setQ] = useState("");
  const p = resolvePeriod({ kind, anchor: today }, today);
  const monthFrom = monthStart(today);

  const flow = useCashFlow(monthFrom, today);
  const pace = usePace();
  const cur = useDailySpend(p.from, p.to);
  const prev = useDailySpend(p.prevFrom, p.prevEnd);
  const cats = useSpendByCategory(monthFrom, today, null);
  const categories = useCategories().data ?? NO_CATEGORIES;
  const { rows: recent } = useRecent(7);
  const cash = useAnimatedNumber(flow.data?.closing_pence);

  const curRows = cur.data ?? [], prevRows = prev.data ?? [];
  const curSpend = curRows.at(-1)?.cumulative_pence ?? 0;
  const prevAt = prevRows[Math.min(curRows.length, prevRows.length) - 1]?.cumulative_pence ?? 0;
  const catRows = cats.data ?? [];
  const total = catRows.reduce((s, r) => s + r.total_pence, 0);
  const fixedIds = useMemo(() => {
    const set = new Set<string>();
    for (const parent of categories.filter((c) => !c.parent_id && c.kind === "expense")) {
      const kids = categories.filter((c) => c.parent_id === parent.id);
      if (kids.length && kids.filter((k) => k.is_fixed).length / kids.length > 0.5) set.add(parent.id);
    }
    return set;
  }, [categories]);
  const f = flow.data;
  const name = profile?.display_name?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const prevMonth = formatMonth(addMonths(monthFrom, -1));

  return (
    <div className="scroll desktop-home">
      <header className="row-between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow" suppressHydrationWarning>{formatLong(today)}</div>
          <h1 className="large-title" style={{ marginTop: 6 }}>{greeting}{name ? `, ${name}` : ""}</h1>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <form onSubmit={(e) => { e.preventDefault(); router.push(`/activity?q=${encodeURIComponent(q)}`); }} role="search">
            <label className="field" style={{ width: 320, height: 40, background: "var(--surface)", fontSize: 15 }}>
              <UI.Search size={18} strokeWidth={1.75} className="faint" aria-hidden />
              <input id="global-search" style={{ flex: 1, background: "none", border: 0, outline: "none", minWidth: 0 }} placeholder="Search transactions" aria-label="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} />
              <kbd style={{ font: "inherit", fontSize: 12, color: "var(--ink-3)", padding: "1px 6px", borderRadius: 5, boxShadow: "inset 0 0 0 1px var(--rule-strong)" }}>/</kbd>
            </label>
          </form>
          <Link href="/settings" className="avatar" aria-label="Settings">{(name[0] ?? "S").toUpperCase()}</Link>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "400px minmax(0,1fr)", gap: 20, marginTop: 20 }}>
        <div className="card" style={{ padding: 28 }} aria-label="Available cash">
          <Link href="/cash" className="hero-label">Available cash <UI.ChevronRight size={16} strokeWidth={1.75} className="chev" aria-hidden /></Link>
          {cash === undefined ? <div className="skeleton" style={{ height: 76, marginTop: 10 }} aria-busy /> : (
            <Link href="/cash" data-testid="hero" aria-label={`Available cash ${formatGBP(f?.closing_pence ?? 0)}`}><Figure pence={cash} xl /></Link>
          )}
          {f && (
            <div className="equation" data-testid="equation">
              <div className="eq-term"><span className="eq-k">Opening</span><span className="eq-v">{formatGBP(f.opening_pence)}</span></div><span className="eq-op">+</span>
              <div className="eq-term"><span className="eq-k">In</span><span className="eq-v pos">{formatGBP(f.income_pence)}</span></div><span className="eq-op">−</span>
              <div className="eq-term"><span className="eq-k">Out</span><span className="eq-v">{formatGBP(f.spend_pence)}</span></div>
              {!!f.pot_pence && <><span className="eq-op">{f.pot_pence < 0 ? "−" : "+"}</span><div className="eq-term"><span className="eq-k">One-off</span><span className="eq-v">{formatGBP(Math.abs(f.pot_pence))}</span></div></>}
              {f.set_aside_pence !== 0 && <><span className="eq-op">{f.set_aside_pence < 0 ? "−" : "+"}</span><div className="eq-term"><span className="eq-k">Set aside</span><span className="eq-v">{formatGBP(Math.abs(f.set_aside_pence))}</span></div></>}
            </div>
          )}
          {pace.data && (
            <div data-testid="pace">
              <div className="track" style={{ marginTop: 28 }}>
                <div className="fill" style={{ width: `${(pace.data.spend_pence / Math.max(1, pace.data.prev_total_pence, pace.data.spend_pence, pace.data.prev_spend_pence)) * 100}%` }} />
                <div className="tick" style={{ left: `${(pace.data.prev_spend_pence / Math.max(1, pace.data.prev_total_pence, pace.data.spend_pence, pace.data.prev_spend_pence)) * 100}%` }} data-label={`${prevMonth.slice(0, 3)} by day ${pace.data.prev_label_day}`} />
              </div>
              <div className="pace-note" style={{ marginTop: 26 }}>
                <i className={`dot ${pace.data.prev_spend_pence >= pace.data.spend_pence ? "pos" : "cau"}`} />
                {formatGBP(Math.abs(pace.data.prev_spend_pence - pace.data.spend_pence))} {pace.data.prev_spend_pence >= pace.data.spend_pence ? "less" : "more"} than this point in {prevMonth}
              </div>
            </div>
          )}
        </div>

        <BillsCard />
        <div className="card chart-card" style={{ padding: "24px 28px" }}>
          <div className="row-between">
            <div>
              <div className="finding" style={{ fontSize: 19 }}>{paceFinding(curSpend, prevAt, p.prevLabel, prevRows.some((d) => d.total_pence > 0))}</div>
              <div className="finding-sub">Cumulative spend, {kind === "month" ? `${formatMonth(monthFrom)} vs ${prevMonth}` : `${p.label} vs ${p.prevLabel}`}</div>
            </div>
            <span className="seg" role="tablist" aria-label="Range" style={{ width: 240 }}>
              {(["month", "quarter", "year"] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k[0]!.toUpperCase() + k.slice(1)}</button>)}
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            {cur.data ? <PaceChart from={p.from} to={p.to} today={today} cur={curRows} prev={prevRows} prevFrom={p.prevFrom} prevLabel={p.prevLabel} curLabel={kind === "month" ? formatMonthYear(p.from).split(" ")[0]! : p.label} height={300} /> : <div className="skeleton" style={{ height: 300 }} aria-busy />}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr) 290px", gap: 20, marginTop: 20, alignItems: "start" }}>
        <div className="card chart-card" style={{ padding: 24 }}>
          <div className="finding">{categoryFinding(catRows, total)}</div>
          <div className="finding-sub">Category spend this month · marker = usual by now</div>
          <div style={{ marginTop: 4 }}><CategoryBars rows={catRows} fixedIds={fixedIds} showUsual href={(id) => `/analytics/category/${id}`} total={total} /></div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div className="row-between"><h2 className="finding" style={{ fontSize: 20 }}>Recent activity</h2><Link className="link" href="/activity" style={{ color: "var(--ink-2)", fontSize: 14 }}>View all</Link></div>
          <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }} data-testid="recent-table">
            <thead><tr style={{ textAlign: "left" }}>{["Payee", "Category", "Amount"].map((h, i) => <th key={h} scope="col" className="eyebrow" style={{ padding: "6px 0", textAlign: i === 2 ? "right" : "left", fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {recent.map((r) => {
                const amt = rowAmount(r);
                return (
                  <tr key={r.client_id} style={{ borderTop: "1px solid var(--rule)", cursor: "pointer" }} onClick={() => open({ edit: r })} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") open({ edit: r }); }} data-testid="txn-row" data-pending={r.pending ? "" : undefined}>
                    <td style={{ padding: "12px 0" }}><span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 500 }}><span className="tile"><CategoryIcon name={r.category_icon ?? undefined} size={18} /></span>{rowTitle(r)}</span></td>
                    <td style={{ padding: "12px 12px" }}><div style={{ fontSize: 14 }}>{r.category_name ?? (r.type === "transfer" ? "Transfer" : "Adjustment")}</div><div className="sub" style={{ marginTop: 2 }}>{recentWhen(r, today) === "Yesterday" ? "Yesterday" : formatLong(r.occurred_on).slice(0, 3) + " " + Number(r.occurred_on.slice(8))} · {rowSubtitle(r).split(" · ").slice(-1)[0]}</div></td>
                    <td className={`num ${amt.positive ? "pos" : ""}`} style={{ textAlign: "right", fontWeight: 500 }}>{amt.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {recent.length === 0 && <p className="sub" style={{ padding: "24px 0" }}>Nothing logged yet. Press <kbd>N</kbd> to add your first transaction.</p>}
        </div>

        <aside aria-label="Insights" className="stack"><InsightCard variant="list" /></aside>
      </section>
    </div>
  );
}
