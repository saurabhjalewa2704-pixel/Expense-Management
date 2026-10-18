"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { upsertCategory } from "@/app/actions/categories";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon, PICKER_ICONS, UI } from "@/lib/icons";
import { CATEGORY_COLORS } from "@/lib/schemas/category";
import { useCategoryTree } from "@/lib/queries/hooks";
import type { Category, CategoryColor, CategoryKind } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  category?: Category;
  kind?: CategoryKind;
  parentId?: string | null;
  nested?: boolean;
  onSaved?: (c: Category) => void;
}

/** CAT-03: name, type, parent (parents only, which keeps the taxonomy at two levels), one of 48 icons, one of 10 tones. */
export function CategoryEditor({ open, onOpenChange, category, kind: initialKind = "expense", parentId: initialParent = null, nested, onSaved }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const { tree } = useCategoryTree();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>(initialKind);
  const [parentId, setParentId] = useState<string | null>(initialParent);
  const [icon, setIcon] = useState("circle-ellipsis");
  const [color, setColor] = useState<CategoryColor>("sage");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setName(category?.name ?? "");
    setKind(category?.kind ?? initialKind);
    setParentId(category ? category.parent_id : initialParent);
    setIcon(category?.icon ?? "circle-ellipsis");
    setColor(category?.color ?? "sage");
  }, [open, category, initialKind, initialParent]);

  const parents = tree.parents(kind).filter((p) => p.id !== category?.id);
  const hasChildren = category ? tree.children(category.id).length > 0 : false;
  const parent = parentId ? tree.byId.get(parentId) : undefined;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const r = await upsertCategory({ id: category?.id, name, kind, parent_id: kind === "income" ? null : parentId, icon, color: parent ? parent.color : color });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await qc.invalidateQueries();
    toast({ message: category ? "Category updated" : `Created ${r.data.name}`, duration: 3000 });
    onOpenChange(false);
    onSaved?.(r.data);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={category ? "Edit category" : "New category"} nested={nested}>
      <div className="vaul-body">
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button>
          <span className="t">{category ? "Edit category" : "New category"}</span>
          <button className="txt" style={{ color: "var(--ink)", fontWeight: 600, opacity: busy || !name.trim() ? 0.4 : 1 }} disabled={busy || !name.trim()} onClick={save}>
            {category ? "Save" : "Create"}
          </button>
        </div>
        <input className="field w-full" style={{ fontWeight: 500 }} placeholder="Name" aria-label="Category name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!category} />

        <div className="list" style={{ marginTop: 12, background: "var(--surface-2)" }}>
          {!category && (
            <div className="row" style={{ minHeight: 50 }}>
              <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Type</div></div>
              <span className="seg" role="tablist" style={{ width: 170, height: 32, background: "var(--surface-3)" }}>
                {(["expense", "income"] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} style={{ borderRadius: 8, fontSize: 14, fontWeight: 500, color: kind === k ? "var(--ink)" : "var(--ink-2)", background: kind === k ? "var(--surface)" : "transparent" }}
                    onClick={() => { setKind(k); if (k === "income") setParentId(null); }}>
                    {k === "expense" ? "Expense" : "Income"}
                  </button>
                ))}
              </span>
            </div>
          )}
          {kind === "expense" && !hasChildren && (
            <button className="row" style={{ minHeight: 50, width: "100%", textAlign: "left" }} onClick={() => setParentOpen(true)} aria-label="Choose parent category">
              <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Inside</div></div>
              <span className="muted" style={{ fontSize: 16 }}>{parent?.name ?? "None"}</span>
              <span className="chev"><UI.ChevronRight size={18} strokeWidth={1.75} /></span>
            </button>
          )}
        </div>

        <div className="eyebrow" style={{ margin: "18px 4px 10px" }}>Icon</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 6 }} role="radiogroup" aria-label="Icon">
          {PICKER_ICONS.map((n) => (
            <button key={n} role="radio" aria-checked={icon === n} aria-label={n.replace(/-/g, " ")} onClick={() => setIcon(n)}
              style={{ height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: icon === n ? "var(--ink)" : "var(--surface-2)", color: icon === n ? "var(--on-ink)" : "var(--ink)" }}>
              <CategoryIcon name={n} size={18} />
            </button>
          ))}
        </div>

        {!parent && kind === "expense" || kind === "income" ? (
          <>
            <div className="eyebrow" style={{ margin: "18px 4px 10px" }}>Colour <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>· used in charts</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0 4px 8px" }} role="radiogroup" aria-label="Colour">
              {CATEGORY_COLORS.map((c) => (
                <button key={c} role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                  style={{ width: 26, height: 26, borderRadius: "50%", background: `var(--cat-${c})`, boxShadow: color === c ? "0 0 0 2.5px var(--surface),0 0 0 4.5px var(--ink)" : undefined }} />
              ))}
            </div>
          </>
        ) : null}
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}
      </div>

      <Sheet open={parentOpen} onOpenChange={setParentOpen} nested title="Choose a parent category">
        <div className="vaul-body">
          <div className="sheet-head"><span /><span className="t">Inside</span><button className="txt" onClick={() => setParentOpen(false)}>Done</button></div>
          <div className="subs" style={{ marginTop: 0 }}>
            {[{ id: null as string | null, name: "None (top level)" }, ...parents].map((p) => (
              <button key={p.id ?? "none"} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => { setParentId(p.id); setParentOpen(false); }}>
                <div className="row-main"><div className="row-t">{p.name}</div></div>
                <span className={`radio ${parentId === p.id ? "on" : ""}`}>{parentId === p.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </Sheet>
  );
}
