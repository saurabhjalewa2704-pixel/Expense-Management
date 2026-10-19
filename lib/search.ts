// ACT-02: one field searches payee, note and category; numbers filter by amount.
//   "12.80"  -> exactly £12.80          ">100" -> £100 or more          "<20" -> £20 or less
//   "coffee >5" -> text "coffee" and £5 or more
import { toPence } from "@/lib/money";

export interface ParsedSearch { text: string; amount?: number; min?: number; max?: number }

export function parseSearch(input: string): ParsedSearch {
  const raw = input.trim();
  if (!raw) return { text: "" };
  const out: ParsedSearch = { text: "" };
  const words: string[] = [];
  const tokens = raw.split(/\s+/);
  for (const t of tokens) {
    const cmp = /^([<>])=?£?([\d,]*\.?\d+)$/.exec(t);
    if (cmp) {
      const p = toPence(cmp[2]!);
      if (p !== null) { if (cmp[1] === ">") out.min = p; else out.max = p; continue; }
    }
    words.push(t);
  }
  const text = words.join(" ");
  // a lone number is an exact amount; a number among words is just text ("7 Eleven")
  if (tokens.length === 1 && /^£?\d[\d,]*(\.\d{1,2})?$/.test(text)) {
    const p = toPence(text);
    if (p !== null) { out.amount = p; return out; }
  }
  out.text = text;
  return out;
}
