"use client";
import { useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { reorderCategories } from "@/app/actions/categories";
import { CategoryEditor } from "@/components/capture/category-editor";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon, UI } from "@/lib/icons";
import { useCategoryTree } from "@/lib/queries/hooks";
import type { Category, CategoryKind } from "@/lib/types";

/** S9: parents with their sub-category counts; New category, reorder (CAT-04), and the archive. */
export function CategoriesScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const { tree, categories, isLoading } = useCategoryTree();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [creating, setCreating] = useState(false);
  const [reordering, setReordering] = useState(false);
  const parents = tree.parents(kind);
  const [order, setOrder] = useState<Category[]>(parents);
  useEffect(() => { setOrder(tree.parents(kind)); }, [categories, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const archived = categories.filter((c) => c.archived_at && !c.parent_id && c.kind === kind);
  const count = (k: CategoryKind) => tree.parents(k).length;

  const persist = async (next: Category[]) => {
    const r = await reorderCategories(next.map((c) => c.id));
    if (!r.ok) toast({ message: r.error, tone: "error" });
    else await qc.invalidateQueries({ queryKey: ["categories"] });
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...order]; const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next); void persist(next);
  };

  return (
    <div className="scroll">
      <PageHeader title="Categories" back="/settings" backLabel="Settings"
        right={<span style={{ display: "flex", gap: 8, marginRight: 8 }}>
          {kind === "expense" && <button className={`icon-btn`} aria-label={reordering ? "Done reordering" : "Reorder categories"} aria-pressed={reordering} onClick={() => setReordering((r) => !r)} style={reordering ? { background: "var(--ink)", color: "var(--on-ink)" } : undefined}><UI.GripVertical size={16} strokeWidth={1.75} aria-hidden /></button>}
          <button className="icon-btn" aria-label="New category" onClick={() => setCreating(true)}><UI.Plus size={18} strokeWidth={2} aria-hidden /></button></span>} />
      <div className="seg" role="tablist" aria-label="Category type" style={{ marginTop: 14 }}>
        <button role="tab" aria-selected={kind === "expense"} className={kind === "expense" ? "on" : ""} onClick={() => { setKind("expense"); setReordering(false); }}>Expense · {count("expense")}</button>
        <button role="tab" aria-selected={kind === "income"} className={kind === "income" ? "on" : ""} onClick={() => { setKind("income"); setReordering(false); }}>Income · {count("income")}</button>
      </div>

      {isLoading ? <div className="list" style={{ marginTop: 16 }} aria-busy><div className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div></div> : reordering ? (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="list" style={{ marginTop: 16, listStyle: "none" }} as="ul">
          {order.map((c, i) => <ReorderRow key={c.id} cat={c} onDrop={() => persist(order)} onUp={() => move(i, -1)} onDown={() => move(i, 1)} first={i === 0} last={i === order.length - 1} />)}
        </Reorder.Group>
      ) : (
        <div className="list" style={{ marginTop: 16 }} data-testid="category-list">
          {parents.map((c) => {
            const n = tree.children(c.id).length;
            return (
              <Link key={c.id} href={`/settings/categories/${c.id}`} className="row">
                <div className="tile"><CategoryIcon name={c.icon} size={20} /></div>
                <div className="row-main"><div className="row-t">{c.name}</div><div className="row-s">{kind === "income" ? "Income" : n === 0 ? "No sub-categories" : `${n} sub-categor${n === 1 ? "y" : "ies"}`}{c.is_fixed ? " · fixed" : ""}</div></div>
                <span className="faint"><UI.ChevronRight size={18} strokeWidth={1.75} aria-hidden /></span>
              </Link>
            );
          })}
        </div>
      )}
      {reordering && <p className="sub" style={{ margin: "10px 16px 0" }}>Drag the handle, or use the arrows. The order is the order of the picker grid.</p>}

      {archived.length > 0 && !reordering && (
        <>
          <div className="eyebrow group-label">Archived · {archived.length}</div>
          <div className="list">
            {archived.map((c) => (
              <Link key={c.id} href={`/settings/categories/${c.id}`} className="row">
                <div className="tile"><CategoryIcon name={c.icon} size={20} /></div>
                <div className="row-main"><div className="row-t muted">{c.name}</div><div className="row-s">Hidden from pickers</div></div>
                <span className="faint"><UI.ChevronRight size={18} strokeWidth={1.75} aria-hidden /></span>
              </Link>
            ))}
          </div>
        </>
      )}
      <CategoryEditor open={creating} onOpenChange={setCreating} kind={kind} />
    </div>
  );
}

function ReorderRow({ cat, onDrop, onUp, onDown, first, last }: { cat: Category; onDrop: () => void; onUp: () => void; onDown: () => void; first: boolean; last: boolean }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={cat} dragListener={false} dragControls={controls} onDragEnd={onDrop} as="li" className="row" style={{ background: "var(--surface)" }} data-testid="reorder-row">
      <div className="tile"><CategoryIcon name={cat.icon} size={20} /></div>
      <div className="row-main"><div className="row-t">{cat.name}</div></div>
      <button aria-label={`Move ${cat.name} up`} disabled={first} onClick={onUp} style={{ opacity: first ? 0.3 : 1 }}><UI.ChevronDown size={18} style={{ transform: "rotate(180deg)" }} aria-hidden /></button>
      <button aria-label={`Move ${cat.name} down`} disabled={last} onClick={onDown} style={{ opacity: last ? 0.3 : 1 }}><UI.ChevronDown size={18} aria-hidden /></button>
      <span onPointerDown={(e) => controls.start(e)} style={{ touchAction: "none", cursor: "grab", padding: 6 }} aria-hidden><UI.GripVertical size={20} strokeWidth={1.75} className="faint" /></span>
    </Reorder.Item>
  );
}
