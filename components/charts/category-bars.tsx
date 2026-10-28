"use client";
import Link from "next/link";
import { CategoryIcon } from "@/lib/icons";
import { deltaFlag } from "@/lib/analytics";
import { formatGBP, pctOf } from "@/lib/money";
import type { CategorySpend } from "@/lib/types";

/** AN-02: horizontal bars sorted by amount, top 8 plus "Everything else"; a marker shows the usual spend by this point. */
export function CategoryBars({ rows, fixedIds, showUsual, href, total }: {
  rows: CategorySpend[]; fixedIds: Set<string>; showUsual: boolean; href: (id: string) => string; total: number;
}) {
  const fixed = rows.filter((r) => fixedIds.has(r.category_id));
  const rest = rows.filter((r) => !fixedIds.has(r.category_id));
  const top = rest.slice(0, 8);
  const other = rest.slice(8);
  const otherTotal = other.reduce((s, r) => s + r.total_pence, 0);
  const scale = Math.max(1, ...top.map((r) => Math.max(r.total_pence, showUsual ? r.norm_pence ?? 0 : 0)), otherTotal);
  return (
    <div data-testid="category-bars">
      {fixed.map((r) => (
        <Link key={r.category_id} href={href(r.category_id)} className="fixed-row" style={{ marginTop: 0 }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 500 }}><CategoryIcon name={r.icon} size={18} />{r.name} <span className="faint" style={{ fontWeight: 400 }}>· fixed costs</span></span>
          <span className="num" style={{ fontWeight: 500 }}>{formatGBP(r.total_pence)}</span>
        </Link>
      ))}
      <div style={{ marginTop: fixed.length ? 4 : 0 }}>
        {top.map((r) => {
          const flag = showUsual ? deltaFlag(r.total_pence, r.norm_pence) : null;
          return (
            <Link key={r.category_id} href={href(r.category_id)} className="cbar-row" data-testid="category-row" aria-label={`${r.name} ${formatGBP(r.total_pence)}, ${pctOf(r.total_pence, total)}% of spending${flag ? `, up ${flag.pct}% on usual` : ""}`}>
              <div className="tile"><CategoryIcon name={r.icon} size={16} /></div>
              <div className="cbar-name">{r.name}{flag && <span className="delta" data-testid="delta">↑ {flag.pct}%</span>}</div>
              <div className="cbar-amt num">{r.total_pence < 0 ? <>£0.00<small style={{ display: "block", color: "var(--ink-3)", fontWeight: 400 }} data-testid="net-refund">net refund {formatGBP(-r.total_pence)}</small></> : formatGBP(r.total_pence)}</div>
              <div className="cbar-track" aria-hidden>
                <div className="b" style={{ width: `${(Math.max(0, r.total_pence) / scale) * 100}%`, background: flag ? "var(--caution)" : undefined, transition: "width 280ms var(--spring)" }} />
                {showUsual && r.norm_pence != null && r.norm_pence > 0 && <div className="n" style={{ left: `${(r.norm_pence / scale) * 100}%` }} />}
              </div>
            </Link>
          );
        })}
        {otherTotal > 0 && (
          <div className="cbar-row">
            <div className="tile"><CategoryIcon name="circle-ellipsis" size={16} /></div>
            <div className="cbar-name">Everything else</div><div className="cbar-amt num">{formatGBP(otherTotal)}</div>
            <div className="cbar-track" aria-hidden><div className="b" style={{ width: `${(otherTotal / scale) * 100}%` }} /></div>
          </div>
        )}
      </div>
      {showUsual && <div className="legend"><span><i />This month</span><span><i className="tick" />Usual by now</span></div>}
    </div>
  );
}
