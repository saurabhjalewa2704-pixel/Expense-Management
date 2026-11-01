// EC-F30: does an expense look like part of a planned extra: the same L1 category, or a shared word between the label and the payee or note.
export interface ExtraLike { id: string; label: string; amount_pence: number; category_id: string | null }
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
export function matchesExtra(e: ExtraLike, l1: string | null, text: string): boolean {
  if (e.category_id && l1 && e.category_id === l1) return true;
  const t = new Set(words(text));
  return words(e.label).some((w) => t.has(w));
}
