"use client";
import { useEffect, useState } from "react";
import { CategoryEditor } from "./category-editor";
import { Sheet } from "@/components/ui/sheet";
import { CategoryIcon, UI } from "@/lib/icons";
import { useCategoryTree } from "@/lib/queries/hooks";
import { useIsDesktop } from "@/lib/use-media";
import type { Category, CategoryKind } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Exclude<CategoryKind, never>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Categories to offer first (this payee's, then the most used), shown with their parent. */
  suggestedIds?: string[];
}

type Tree = ReturnType<typeof useCategoryTree>["tree"];

function Radio({ on }: { on: boolean }) {
  return <span className={`radio ${on ? "on" : ""}`}>{on && <UI.Check size={14} strokeWidth={2.5} />}</span>;
}

/** A parent's list: an explicit "(general)" row for the parent itself, then its sub-categories. */
function ListRows({ tree, parentId, selectedId, pick }: { tree: Tree; parentId: string; selectedId: string | null; pick: (id: string) => void }) {
  const parent = tree.byId.get(parentId);
  if (!parent) return null;
  return (
    <div className="subs" style={{ marginTop: 0 }} data-testid="cat-list">
      <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(parent.id)}>
        <div className="tile"><CategoryIcon name={parent.icon} size={18} /></div>
        <div className="row-main"><div className="row-t">{parent.name} (general)</div><div className="row-s">Anything in {parent.name}</div></div>
        <Radio on={selectedId === parent.id} />
      </button>
      {tree.children(parentId).map((c) => (
        <button key={c.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c.id)}>
          <div className="tile"><CategoryIcon name={c.icon} size={18} /></div>
          <div className="row-main"><div className="row-t">{c.name}</div></div>
          <Radio on={selectedId === c.id} />
        </button>
      ))}
    </div>
  );
}

/**
 * S3. Phones: a parent grid; tapping a parent slides the same sheet to that parent's list ("‹ Back", an explicit
 * "<Parent> (general)" row, then its sub-categories), and any choice closes the sheet. Desktop modal: two panes, parents on
 * the left and the highlighted parent's list on the right. A suggested row and a search that spans both levels sit on top.
 */
export function CategoryPicker({ open, onOpenChange, kind, selectedId, onSelect, suggestedIds = [] }: Props) {
  const { tree } = useCategoryTree();
  const desktop = useIsDesktop();
  const parents = tree.parents(kind);
  const selectedRoot = selectedId ? tree.root(selectedId)?.id ?? null : null;
  const [drill, setDrill] = useState<string | null>(null);   // phones: the parent whose list is showing
  const [pane, setPane] = useState<string | null>(null);     // desktop: the parent highlighted on the left
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const total = parents.reduce((n, p) => n + 1 + tree.children(p.id).length, 0);

  // Opening with a category already chosen lands on its parent's list, with the choice marked.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDrill(selectedRoot && tree.children(selectedRoot).length ? selectedRoot : null);
    setPane(selectedRoot ?? parents[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches: Category[] = [];
  if (q) {
    for (const p of parents) {
      if (p.name.toLowerCase().includes(q)) matches.push(p);
      for (const c of tree.children(p.id)) if (c.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) matches.push(c);
    }
  }
  const suggested = suggestedIds.map((id) => tree.byId.get(id)).filter((c): c is Category => !!c && !c.archived_at).slice(0, 6);

  const pick = (id: string) => { onSelect(id); onOpenChange(false); setQuery(""); setDrill(null); };
  const tapParent = (p: Category) => {
    if (tree.children(p.id).length === 0) return pick(p.id);
    if (desktop) setPane(p.id); else setDrill(p.id);
  };
  const parentOfNew = kind === "expense" ? (desktop ? pane : drill) : null;
  const drilled = !desktop && !q && drill ? tree.byId.get(drill) : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQuery(""); setDrill(null); } }} nested title="Choose a category" maxHeight="92dvh">
      <div className="vaul-body">
        <div className="sheet-head">
          {drilled
            ? <button className="txt" onClick={() => setDrill(null)} aria-label="Back to all categories" style={{ display: "flex", alignItems: "center", gap: 2 }}><UI.ChevronLeft size={18} strokeWidth={2} aria-hidden />Categories</button>
            : <button className="txt" onClick={() => onOpenChange(false)}>Cancel</button>}
          <span className="t">{drilled ? drilled.name : "Category"}</span>
          <button className="txt" style={{ color: "var(--ink)", fontWeight: 600 }} onClick={() => setCreating(true)}>New</button>
        </div>

        {!drilled && (
          <label className="field" style={{ height: 44 }}>
            <UI.Search size={18} strokeWidth={1.75} className="faint" aria-hidden />
            <input style={{ flex: 1, background: "none", border: 0, outline: "none", minWidth: 0 }} placeholder={`Search ${total} categories`} aria-label="Search categories" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}

        {q ? (
          <div className="subs" style={{ marginTop: 16 }}>
            {matches.length === 0 && <div className="row"><div className="row-main sub">No categories match “{query}”.</div></div>}
            {matches.map((c) => (
              <button key={c.id} className="row" style={{ width: "100%", textAlign: "left" }} onClick={() => pick(c.id)}>
                <div className="tile"><CategoryIcon name={c.icon} size={18} /></div>
                <div className="row-main"><div className="row-t">{c.name}</div><div className="row-s">{c.parent_id ? tree.byId.get(c.parent_id)?.name : "Whole category"}</div></div>
                <Radio on={selectedId === c.id} />
              </button>
            ))}
          </div>
        ) : drilled ? (
          <div className="pane-in" style={{ marginTop: 8 }}><ListRows tree={tree} parentId={drilled.id} selectedId={selectedId} pick={pick} /></div>
        ) : (
          <>
            {suggested.length > 0 && (
              <div style={{ marginTop: 16 }} data-testid="cat-suggested">
                <div className="eyebrow" style={{ margin: "0 4px 8px" }}>Suggested</div>
                <div className="chips nowrap" style={{ overflowX: "auto", scrollbarWidth: "none" }}>
                  {suggested.map((c) => (
                    <button key={c.id} className={`chip ${selectedId === c.id ? "sel" : ""}`} aria-label={`Suggested: ${tree.path(c.id)}`} onClick={() => pick(c.id)}>
                      <CategoryIcon name={c.icon} size={16} />{tree.path(c.id)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {desktop ? (
              <div className="cat-panes" data-testid="cat-panes">
                <div className="subs" style={{ marginTop: 0 }} role="group" aria-label="Categories">
                  {parents.map((p) => (
                    <button key={p.id} className="row" aria-current={pane === p.id ? "true" : undefined} style={{ width: "100%", textAlign: "left" }} onClick={() => tapParent(p)}>
                      <div className="tile"><CategoryIcon name={p.icon} size={18} /></div>
                      <div className="row-main"><div className="row-t">{p.name}</div></div>
                      {tree.children(p.id).length > 0 ? <UI.ChevronRight size={16} strokeWidth={1.75} className="chev" aria-hidden /> : <Radio on={selectedId === p.id} />}
                    </button>
                  ))}
                </div>
                {pane && tree.children(pane).length > 0 && <ListRows tree={tree} parentId={pane} selectedId={selectedId} pick={pick} />}
              </div>
            ) : (
              <div className="cat-grid" style={{ marginTop: 20 }}>
                {parents.map((p) => (
                  <button key={p.id} className={`cat ${selectedRoot === p.id ? "sel" : ""}`} onClick={() => tapParent(p)} aria-pressed={selectedRoot === p.id}>
                    <span className="sq"><CategoryIcon name={p.icon} size={24} /></span>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <CategoryEditor open={creating} onOpenChange={setCreating} nested kind={kind} parentId={parentOfNew} onSaved={(c) => pick(c.id)} />
    </Sheet>
  );
}
