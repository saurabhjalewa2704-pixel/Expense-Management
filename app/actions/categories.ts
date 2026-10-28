"use server";
import { z } from "zod";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/action";
import { CategoryInput } from "@/lib/schemas/category";
import { supabaseServer } from "@/lib/supabase/server";
import type { Category } from "@/lib/types";

export async function upsertCategory(input: unknown): Promise<ActionResult<Category>> {
  const p = CategoryInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Check the category.");
  const v = p.data;
  const supabase = await supabaseServer();
  if (v.id) {
    const { data, error } = await supabase.from("categories")
      .update({ name: v.name, icon: v.icon, color: v.color, parent_id: v.parent_id ?? null }).eq("id", v.id).select().single();
    return error ? fail(friendlyDbError(error)) : ok(data as Category);
  }
  const siblings = supabase.from("categories").select("sort_order").eq("kind", v.kind);
  const { data: last } = await (v.parent_id ? siblings.eq("parent_id", v.parent_id) : siblings.is("parent_id", null))
    .order("sort_order", { ascending: false }).limit(1);
  const sort = ((last?.[0] as { sort_order: number } | undefined)?.sort_order ?? 0) + 1;
  const { data, error } = await supabase.from("categories").insert({
    name: v.name, kind: v.kind, parent_id: v.parent_id ?? null, icon: v.icon, color: v.color, sort_order: sort,
  }).select().single();
  return error ? fail(friendlyDbError(error)) : ok(data as Category);
}

export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  if (!z.array(z.uuid()).safeParse(ids).success) return fail("Invalid order.");
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("reorder_categories", { p_ids: ids });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Archive hides a category from pickers but keeps its history; it is allowed at any time (CAT-04). */
export async function archiveCategory(id: string, archived = true): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const at = archived ? new Date().toISOString() : null;
  const { error } = await supabase.from("categories").update({ archived_at: at }).or(`id.eq.${id},parent_id.eq.${id}`);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** TRIP-05: mark a category as "Travel-like" so its expenses are offered as earlier bookings for a trip. */
export async function setTravelLike(id: string, value: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("categories").update({ travel_like: value }).eq("id", id);
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

/** Delete is only for categories with no transactions; otherwise the UI offers Merge into… */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error?.code === "23503") return fail("This category has transactions or sub-categories. Merge it into another instead.");
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}

export async function mergeCategory(from: string, into: string, clash: "combine" | "keep_both" = "combine"): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("merge_category", { p_from: from, p_into: into, p_clash: clash });
  return error ? fail(friendlyDbError(error)) : ok(undefined);
}
