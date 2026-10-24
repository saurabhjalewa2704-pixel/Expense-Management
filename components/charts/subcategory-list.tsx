"use client";
import { useState } from "react";
import { UI } from "@/lib/icons";
import { useCategories } from "@/lib/queries/hooks";
import { formatGBP } from "@/lib/money";
import type { CategorySpend } from "@/lib/types";
import { rowScale, SubcategoryRow } from "./subcategory-row";

const TOP = 8;

/** AN-02c: every sub-category across all parents, ranked; the top 8, "Show all N", and fixed costs folded into one summary row. */
export function SubcategoryList({ rows, showUsual, href, total }: {
  rows: CategorySpend[]; showUsual: boolean; href: (r: CategorySpend) => string; total: number;
}) {
  const [all, setAll] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const flexible = rows.filter((r) => !r.is_fixed);
  const cats = useCategories().data ?? [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const order = new Map(cats.map((c) => [c.id, (c.parent_id ? byId.get(c.parent_id)?.sort_order ?? 0 : c.sort_order) * 1000 + (c.parent_id ? c.sort_order : 0)]));
  // fixed costs read in the taxonomy's own order (Rent & mortgage, Council tax, Energy…), not by amount
  const fixed = rows.filter((r) => r.is_fixed).sort((a, b) => (order.get(a.category_id) ?? 0) - (order.get(b.category_id) ?? 0));
  const shown = all ? flexible : flexible.slice(0, TOP);
  const scale = rowScale(flexible, showUsual);
  const fixedTotal = fixed.reduce((s, r) => s + r.total_pence, 0);
  const names = fixed.slice(0, 3).map((r) => r.name).join(", ");
  const more = fixed.length - 3;
  const caption = (r: CategorySpend) => (r.is_parent_direct ? "Not in a sub-category" : r.parent_name ?? "");
  return (
    <div data-testid="subcategory-list">
      {shown.map((r) => <SubcategoryRow key={r.category_id} row={r} caption={caption(r)} scale={scale} showUsual={showUsual} href={href(r)} total={total} />)}
      {flexible.length > TOP && (
        <button className="show-all" aria-expanded={all} data-testid="show-all" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${flexible.length} sub-categories`}<UI.ChevronDown size={16} strokeWidth={2} aria-hidden style={{ transform: all ? "rotate(180deg)" : undefined }} />
        </button>
      )}
      {fixed.length > 0 && (
        <>
          <button className="fixed-sum" aria-expanded={fixedOpen} data-testid="fixed-costs" onClick={() => setFixedOpen((v) => !v)}>
            <span className="lbl"><b style={{ fontWeight: 500 }}>Fixed costs · {fixed.length}</b><span>{names}{more > 0 ? ` and ${more} more` : ""}</span></span>
            <span className="num" style={{ fontWeight: 500 }}>{formatGBP(fixedTotal)}</span>
          </button>
          {fixedOpen && fixed.map((r) => <SubcategoryRow key={r.category_id} row={r} caption={caption(r)} scale={Math.max(1, ...fixed.map((x) => x.total_pence))} showUsual={false} href={href(r)} total={total} />)}
        </>
      )}
    </div>
  );
}
