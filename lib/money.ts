// Money is integer pence. No floats in storage, arithmetic or payloads (PRD §10.1).
// `Pence` is a plain integer `number`: PostgREST returns bigint columns as JSON numbers, and
// every figure in this app is far below 2^53 pence.

export type Pence = number;

export const MAX_PENCE = 99_999_999; // £999,999.99, the Quick Add ceiling (CAP-01)
const MINUS = "−"; // a real minus sign, not a hyphen (PRD §10.1)

export function assertPence(p: number, label = "amount"): asserts p is Pence {
  if (!Number.isSafeInteger(p)) throw new Error(`${label} must be integer pence, got ${p}`);
}

/**
 * Parse a user-typed amount into pence without ever going through a float.
 *  "12.80" -> 1280 · "0.1" -> 10 · "12." -> 1200 · ".5" -> 50 · "1,234.50" -> 123450 · "£3" -> 300
 * More than two decimals rounds half up: "0.005" -> 1. Returns null for anything that is not an amount.
 */
export function toPence(input: string): Pence | null {
  const s = input.trim().replace(/[£,\s]/g, "");
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const [, neg, whole = "", frac = ""] = m;
  const digits = frac.padEnd(3, "0");
  let pence = Number(whole || "0") * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) pence += 1;
  if (!Number.isSafeInteger(pence)) return null;
  return neg ? -pence : pence;
}

const poundsFmt = new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const groupFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export interface FormatOptions {
  /** Show "+" on positive amounts (income rows). */
  signed?: boolean;
  /** Drop the pence: "£2,940". */
  whole?: boolean;
}

/** "£4,765.55", "−£1,184.73", "+£121.60". Built from integer parts, so nothing is ever rounded. */
export function formatGBP(pence: Pence, opts: FormatOptions = {}): string {
  assertPence(pence);
  const abs = Math.abs(pence);
  // whole pounds are rounded to the nearest pound (£395.90 -> £396); with pence they are exact
  const pounds = opts.whole ? Math.round(abs / 100) : Math.trunc(abs / 100);
  const pp = String(abs % 100).padStart(2, "0");
  const sign = pence < 0 ? MINUS : opts.signed && pence > 0 ? "+" : "";
  const body = poundsFmt.format(pounds);
  return `${sign}${body}${opts.whole ? "" : `.${pp}`}`;
}

/** The pieces of the hero figure: "£" "4,765" ".55" (sign carried separately). */
export function splitGBP(pence: Pence): { sign: string; whole: string; pence: string } {
  assertPence(pence);
  const abs = Math.abs(pence);
  return {
    sign: pence < 0 ? MINUS : "",
    whole: groupFmt.format(Math.trunc(abs / 100)),
    pence: String(abs % 100).padStart(2, "0"),
  };
}

export const sumPence = (xs: readonly Pence[]): Pence => xs.reduce((a, b) => a + b, 0);

/** Whole-number percentage change from `base` to `value` (not money, so rounding is fine). null when base is 0. */
export function pctChange(value: Pence, base: Pence): number | null {
  if (base === 0) return null;
  return Math.round(((value - base) * 100) / Math.abs(base));
}

/** Share of a total as a whole percentage. */
export function pctOf(part: Pence, total: Pence): number {
  return total === 0 ? 0 : Math.round((part * 100) / total);
}

/** Median of integer pence, rounded to a whole penny. */
export function medianPence(xs: readonly Pence[]): Pence {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Effect on a keypad entry string when a key is pressed (CAP-01): max 2 decimals, max £999,999.99,
 * a leading "." becomes "0.", and no leading zeros.
 */
export function pressKey(current: string, key: string): string {
  if (key === "back") return current.slice(0, -1);
  if (key === "clear") return "";
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  if (!/^\d$/.test(key)) return current;
  const [whole = "", frac] = current.split(".");
  if (frac !== undefined) {
    if (frac.length >= 2) return current;
  } else if (whole === "0") {
    return key === "0" ? current : key; // no "007"
  }
  const next = current + key;
  const p = toPence(next);
  return p !== null && p > MAX_PENCE ? current : next;
}

/** "12.80" / "-3.05" from integer pence, for CSV and JSON exports (no float, no currency symbol). */
export function penceToDecimal(pence: Pence): string {
  assertPence(pence);
  const abs = Math.abs(pence);
  return `${pence < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
