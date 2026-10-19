"use client";
import { useState } from "react";
import { CategoryEditor } from "./category-editor";
import { Sheet } from "@/components/ui/sheet";
import { CategoryIcon, UI } from "@/lib/icons";
import { useCategoryTree } from "@/lib/queries/hooks";
import type { Category, CategoryKind } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Exclude<CategoryKind, never>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** S3: a 4-column grid of parents; tapping one reveals its sub-categories; tapping it again picks the parent itself. */
export function CategoryPicker({ open, onOpenChange, kind, selectedId, onSelect }: Props) {
  const { tree } = useCategoryTree();
  const parents = tree.parents(kind);
  const selectedRoot = selectedId ? tree.root(selectedId)?.id ?? null : null;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const open_ = expanded ?? selectedRoot;
  const subs = open_ ? tree.children(open_) : [];
  const total = parents.reduce((n, p) => n + 1 + tree.children(p.id).length, 0);

  const q = query.trim().toLowerCase();
  const matches: Category[] = [];
  if (q) {
    for (const p of parents) {
      if (p.name.toLowerCase().includes(q)) matches.push(p);
      for (const c of tree.children(p.id)) if (c.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) matches.push(c);
    }
  }

  const pick = (id: string) => { onSelect(id); onOpenChange(false); setQuery(""); setExpanded(null); };
  const tapParent = (p: Category) => {
    const kids = tree.children(p.id);
    if (kids.length === 0) return pick(p.id);
    if (open_ === p.id && expanded === p.id) return pick(p.id); // tap again: the parent itself ("all")
    setExpanded(p.id);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQuery(""); setExpanded(null); } }} nested title="Choose a category" maxHeight="92dvh">
      <div className="vaul-body">
        <div className="sheet-head">
          <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button>
          <span className="t">Category</span>
          <button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => setCreating(true)}>New</button>
        </div>
        <label className="field" style={{ height: 44 }}>
          <UI.Search size={18} strokeWidth={1.75} className="faint" aria-hidden />
          <input style={{ flex: 1, background: "none", border: 0, outline: "none", minWidth: 0 }} placeholder={`Search ${total} categories`} aria-label="Search categories" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>

        {query.trim() ? (
          <div className="subs" style={{ marginTop: 16 }}>
            {matches.length === 0 && <div className="row"><div className="row-main sub">No categories match “{query}”.</div></div>}
            {matches.map((c) => (
              <button key={c.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c.id)}>
                <div className="tile"><CategoryIcon name={c.icon} size={18} /></div>
                <div className="row-main"><div className="row-t">{c.name}</div>{c.parent_id && <div className="row-s">{tree.byId.get(c.parent_id)?.name}</div>}</div>
                <span className={`radio ${selectedId === c.id ? "on" : ""}`}>{selectedId === c.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="cat-grid" style={{ marginTop: 20 }}>
              {parents.map((p) => (
                <button key={p.id} className={`cat ${(open_ ?? selectedRoot) === p.id ? "sel" : ""}`} onClick={() => tapParent(p)} aria-pressed={selectedRoot === p.id}>
                  <span className="sq"><CategoryIcon name={p.icon} size={24} /></span>
                  {p.name}
                </button>
              ))}
            </div>
            {open_ && subs.length > 0 && (
              <>
                <div className="row-between" style={{ margin: "22px 4px 8px" }}>
                  <span className="eyebrow">In {tree.byId.get(open_)?.name}</span>
                  <span className="sub">or tap the tile again for all</span>
                </div>
                <div className="subs" style={{ marginTop: 0 }}>
                  {subs.map((c) => (
                    <button key={c.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c.id)}>
                      <div className="row-main"><div className="row-t">{c.name}</div></div>
                      <span className={`radio ${selectedId === c.id ? "on" : ""}`}>{selectedId === c.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <CategoryEditor open={creating} onOpenChange={setCreating} nested kind={kind} parentId={kind === "expense" ? expanded : null} onSaved={(c) => pick(c.id)} />
    </Sheet>
  );
}
