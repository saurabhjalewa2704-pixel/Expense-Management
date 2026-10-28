"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveCategory, deleteCategory, mergeCategory, setTravelLike } from "@/app/actions/categories";
import { CategoryEditor } from "@/components/capture/category-editor";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon, UI } from "@/lib/icons";
import { useCategoryTree } from "@/lib/queries/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Category } from "@/lib/types";

/** Edit, add a sub-category, archive, merge into another, or delete (only with no transactions): CAT-04. */
export function CategoryDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { tree, isLoading } = useCategoryTree();
  const cat = tree.byId.get(id);
  const subs = cat && !cat.parent_id ? tree.children(cat.id) : [];
  const ids = cat ? [cat.id, ...subs.map((s) => s.id)] : [];
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();

  const usage = useQuery({
    queryKey: ["category-usage", id], enabled: ids.length > 0,
    queryFn: async () => {
      const { count } = await supabaseBrowser().from("transactions").select("id", { count: "exact", head: true }).in("category_id", ids).is("deleted_at", null);
      return count ?? 0;
    },
  });

  if (!cat) return <div className="scroll"><PageHeader title={isLoading ? "Category" : "Not found"} back="/settings/categories" backLabel="Categories" /></div>;
  const parent = cat.parent_id ? tree.byId.get(cat.parent_id) : undefined;
  const refresh = () => qc.invalidateQueries();

  const toggleArchive = async () => {
    const r = await archiveCategory(cat.id, !cat.archived_at);
    if (!r.ok) return setError(r.error);
    await refresh();
    toast({ message: cat.archived_at ? `${cat.name} restored` : `${cat.name} archived`, duration: 3000 });
  };
  const remove = async () => {
    const r = await deleteCategory(cat.id);
    if (!r.ok) { setConfirmDelete(false); return setError(r.error); }
    await refresh();
    toast({ message: `Deleted ${cat.name}`, duration: 3000 });
    router.replace("/settings/categories");
  };

  return (
    <div className="scroll">
      <PageHeader title={cat.name} back={parent ? `/settings/categories/${parent.id}` : "/settings/categories"} backLabel={parent?.name ?? "Categories"}
        right={<button className="icon-btn" aria-label="Edit category" style={{ marginRight: 8 }} onClick={() => setEditing(cat)}><UI.Pencil size={16} strokeWidth={1.75} aria-hidden /></button>} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <div className="tile" style={{ width: 44, height: 44 }}><CategoryIcon name={cat.icon} size={22} /></div>
        <div><div className="sub">{cat.kind === "income" ? "Income category" : parent ? `Inside ${parent.name}` : "Expense category"}{cat.archived_at ? " · Archived" : ""}</div>
          <div className="sub" data-testid="usage">{usage.data === undefined ? "…" : `${usage.data} transaction${usage.data === 1 ? "" : "s"}`}</div></div>
        <span style={{ marginLeft: "auto", width: 20, height: 20, borderRadius: "50%", background: `var(--cat-${cat.color})` }} aria-label={`Colour ${cat.color}`} />
      </div>

      {!cat.parent_id && cat.kind === "expense" && (
        <>
          <div className="section-h"><h2>Sub-categories</h2><button className="link" onClick={() => setAdding(true)}><UI.Plus size={16} strokeWidth={2} aria-hidden />Add</button></div>
          {subs.length === 0 ? <p className="sub" style={{ margin: "0 4px" }}>None yet. Sub-categories keep this one organised; analytics roll them up.</p> : (
            <div className="list">{subs.map((s) => (
              <Link key={s.id} href={`/settings/categories/${s.id}`} className="row">
                <div className="tile"><CategoryIcon name={s.icon} size={20} /></div>
                <div className="row-main"><div className="row-t">{s.name}</div>{s.is_fixed && <div className="row-s">Fixed cost</div>}</div>
                <span className="faint"><UI.ChevronRight size={18} strokeWidth={1.75} aria-hidden /></span>
              </Link>))}
            </div>
          )}
        </>
      )}

      {cat.kind === "expense" && (
        <div className="list" style={{ marginTop: 20 }}>
          <div className="row">
            <div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Travel-like</div><div className="row-s">Offer its expenses as earlier bookings when you plan a trip</div></div>
            <Switch label="Travel-like" checked={!!cat.travel_like} onChange={async (v) => { const r = await setTravelLike(cat.id, v); if (!r.ok) return setError(r.error); await refresh(); }} />
          </div>
        </div>
      )}

      <div className="stack" style={{ marginTop: 28, gap: 10 }}>
        <button className="btn secondary" style={{ height: 48 }} onClick={() => setMerging(true)}><UI.Merge size={18} strokeWidth={1.75} aria-hidden />Merge into another category</button>
        <button className="btn secondary" style={{ height: 48 }} onClick={toggleArchive}><UI.Archive size={18} strokeWidth={1.75} aria-hidden />{cat.archived_at ? "Restore to pickers" : "Archive (hide from pickers)"}</button>
        {usage.data === 0 && subs.length === 0 && (
          confirmDelete ? (
            <div className="card"><div className="headline">Delete {cat.name}?</div><p className="sub" style={{ marginTop: 4 }}>It has no transactions, so nothing is lost.</p>
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn" style={{ height: 46, background: "var(--danger)", color: "var(--ink)" }} onClick={remove}>Delete</button>
                <button className="btn secondary" style={{ height: 46 }} onClick={() => setConfirmDelete(false)}>Keep it</button></div></div>
          ) : <button className="btn secondary" style={{ height: 48, color: "var(--danger)" }} onClick={() => setConfirmDelete(true)}><UI.Trash2 size={18} strokeWidth={1.75} aria-hidden />Delete category</button>
        )}
        {usage.data !== undefined && usage.data > 0 && <p className="sub" style={{ margin: "0 4px" }}>Categories with transactions can&apos;t be deleted. Merge it into another, then it is archived.</p>}
      </div>
      {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}

      <CategoryEditor open={!!editing} onOpenChange={(o) => !o && setEditing(null)} category={editing ?? undefined} />
      <CategoryEditor open={adding} onOpenChange={setAdding} kind="expense" parentId={cat.id} />
      <MergeSheet open={merging} onOpenChange={setMerging} source={cat} onDone={async (target) => { await refresh(); toast({ message: `Merged ${cat.name} into ${target.name}`, duration: 4000 }); router.replace("/settings/categories"); }} />
    </div>
  );
}

function MergeSheet({ open, onOpenChange, source, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; source: Category; onDone: (target: Category) => void | Promise<void> }) {
  const { tree } = useCategoryTree();
  const [target, setTarget] = useState<Category | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [clash, setClash] = useState<"combine" | "keep_both">("combine");
  const kids = tree.children(source.id);
  const own = new Set([source.id, ...kids.map((c) => c.id)]);
  // a category with sub-categories can only move into a top-level one (two levels only)
  const options = tree.parents(source.kind).flatMap((p) => [p, ...(kids.length ? [] : tree.children(p.id))]).filter((c) => !own.has(c.id));
  // EC-K2: sub-categories that share a name with one already under the target
  const clashes = target && !target.parent_id ? kids.filter((k) => tree.children(target.id).some((c) => c.name.toLowerCase() === k.name.toLowerCase())) : [];
  const go = async () => {
    if (!target) return;
    setBusy(true);
    const r = await mergeCategory(source.id, target.id, clash);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onOpenChange(false);
    await onDone(target);
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setTarget(null); setError(undefined); } }} title="Merge into another category" maxHeight="92dvh">
      <div className="vaul-body">
        <div className="sheet-head"><button className="txt" onClick={() => onOpenChange(false)}>Cancel</button><span className="t">Merge into…</span><span /></div>
        <p className="sub" style={{ marginBottom: 12 }}>Every transaction in {source.name} moves to the category you choose{kids.length ? ", and its sub-categories move under it" : ""}, then {source.name} is archived.</p>
        <div className="subs" style={{ marginTop: 0 }}>
          {options.map((c) => (
            <button key={c.id} className="row" style={{ width: "100%", textAlign: "left", paddingLeft: c.parent_id ? 36 : 16 }} onClick={() => setTarget(c)} aria-pressed={target?.id === c.id}>
              <div className="row-main"><div className="row-t" style={{ fontWeight: c.parent_id ? 400 : 500 }}>{c.name}</div></div>
              <span className={`radio ${target?.id === c.id ? "on" : ""}`}>{target?.id === c.id && <UI.Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>
        {clashes.length > 0 && (
          <div className="card" style={{ marginTop: 12 }} data-testid="merge-clash">
            <div className="headline">{clashes.map((k) => k.name).join(", ")} {clashes.length === 1 ? "is" : "are"} in both.</div>
            <div className="seg" role="radiogroup" aria-label="Same-named sub-categories" style={{ marginTop: 10 }}>
              <button role="radio" aria-checked={clash === "combine"} className={clash === "combine" ? "on" : ""} onClick={() => setClash("combine")}>Combine</button>
              <button role="radio" aria-checked={clash === "keep_both"} className={clash === "keep_both" ? "on" : ""} onClick={() => setClash("keep_both")}>Keep both</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 12 }}>{error}</p>}
        <button className="btn" style={{ marginTop: 16, opacity: target && !busy ? 1 : 0.4 }} disabled={!target || busy} onClick={go}>{target ? `Merge into ${target.name}` : "Choose a category"}</button>
      </div>
    </Sheet>
  );
}
