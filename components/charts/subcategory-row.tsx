"use client";
import Link from "next/link";
import { CategoryIcon, UI } from "@/lib/icons";
import { deltaFlag, leafLabel } from "@/lib/analytics";
import { formatGBP, pctOf } from "@/lib/money";
import type { CategorySpend } from "@/lib/types";

/** AN-02c: three lines: icon, name, flag and amount; a 12px caption (parent, or visits · average); a bar with the "usual by now" marker. */
export function SubcategoryRow({ row, caption, scale, showUsual, href, total }: {
  row: CategorySpend; caption: string; scale: number; showUsual: boolean; href: string; total: number;
}) {
  const flag = showUsual ? deltaFlag(row.total_pence, row.norm_pence) : null;
  const name = leafLabel(row);
  return (
    <Link href={href} className="sub-row" data-testid="subcategory-row"
      aria-label={`${name}, ${caption}, ${formatGBP(row.total_pence)}, ${pctOf(row.total_pence, total)}% of spending${flag ? `, up ${flag.pct}% on usual` : ""}`}>
      <div className="tile"><CategoryIcon name={row.icon} size={16} /></div>
      <div className="cbar-name">{name}{flag && <span className="delta" data-testid="delta">↑ {flag.pct}%</span>}</div>
      <div className="cbar-amt num">{formatGBP(row.total_pence)}</div>
      <span className="chev" aria-hidden><UI.ChevronRight size={14} strokeWidth={2} /></span>
      <div className="sub-cap">{caption}</div>
      <div className="cbar-track" aria-hidden>
        <div className="b" style={{ width: `${Math.min(100, (row.total_pence / scale) * 100)}%`, background: flag ? "var(--caution)" : undefined, transition: "width 280ms var(--spring)" }} />
        {showUsual && row.norm_pence != null && row.norm_pence > 0 && <div className="n" style={{ left: `${Math.min(100, (row.norm_pence / scale) * 100)}%` }} />}
      </div>
    </Link>
  );
}

/** The bar scale for a list of rows: the largest total or usual marker, whichever is bigger. */
export const rowScale = (rows: readonly CategorySpend[], showUsual: boolean) =>
  Math.max(1, ...rows.map((r) => Math.max(r.total_pence, showUsual ? r.norm_pence ?? 0 : 0)));
