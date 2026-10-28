// TRIP-06: foreign currency, integers only. A rate is a decimal string with at most 8 decimals (GBP per 1 unit of the currency); money
// is carried in minor units. Nothing here touches floating point, so rounding is exact: half-even to the penny (EC-M4).
import type { Pence } from "@/lib/money";

/** ISO 4217 minor-unit exponents that are not 2. */
const ZERO = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const exponentOf = (currency: string): number => (ZERO.has(currency.toUpperCase()) ? 0 : THREE.has(currency.toUpperCase()) ? 3 : 2);

const RATE_SCALE = 8;
const pow10 = (n: number) => 10n ** BigInt(n);

/** n / d rounded half-even (n ≥ 0, d > 0). */
function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d, r = n % d, twice = r * 2n;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

/** A rate as an integer scaled by 1e8. Accepts the string or number PostgREST gives back for numeric(18,8). */
export function scaleRate(rate: string | number): bigint {
  const s = typeof rate === "number" ? rate.toFixed(RATE_SCALE) : rate.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a rate: ${s}`);
  const frac = (m[2] ?? "").padEnd(RATE_SCALE + 1, "0");
  const whole = BigInt(m[1]! + frac.slice(0, RATE_SCALE));
  return frac.charCodeAt(RATE_SCALE) >= 53 ? whole + 1n : whole;     // the 9th decimal rounds half-up
}
export const rateString = (scaled: bigint): string => `${scaled / pow10(RATE_SCALE)}.${String(scaled % pow10(RATE_SCALE)).padStart(RATE_SCALE, "0")}`;
/** For the screen: "0.7900". */
export const rateLabel = (rate: string | number, dp = 4): string => {
  const s = rateString(scaleRate(rate));
  const [w, f = ""] = s.split(".");
  return `${w}.${f.slice(0, dp).padEnd(dp, "0")}`;
};

/** £ in pence for an amount in minor units: round_half_even(minor × rate × (1 + fee) × 100 / 10^exponent). */
export function convertToPence(minor: number, currency: string, rate: string | number, feeBps = 0): Pence {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Amount must be a whole number of minor units");
  const n = BigInt(minor) * scaleRate(rate) * BigInt(10_000 + feeBps) * 100n;
  const d = pow10(exponentOf(currency)) * pow10(RATE_SCALE) * 10_000n;
  return Number(divHalfEven(n, d));
}

/** The rate that turns the original amount into the pence actually charged, e.g. £39.10 for $48.60 → 0.8045. */
export function effectiveRate(pence: Pence, minor: number, currency: string): string {
  if (minor <= 0) return "0.0000";
  const n = BigInt(pence) * pow10(exponentOf(currency)) * 10_000n;
  const d = BigInt(minor) * 100n;
  const scaled = divHalfEven(n, d);
  return `${scaled / 10_000n}.${String(scaled % 10_000n).padStart(4, "0")}`;
}

/** "48.60" → 4860 (JPY: "1200" → 1200). Extra decimals are ignored, commas stripped (EC-M1). Null when it is not an amount. */
export function parseMinor(text: string, currency: string): number | null {
  const t = text.replace(/,/g, "").trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const exp = exponentOf(currency);
  const frac = (m[2] ?? "").padEnd(exp, "0").slice(0, exp);
  const minor = Number(`${m[1] || "0"}${frac}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** "$48.60", "¥1,200", "KWD 12.345": the original amount in its own currency. */
export function formatMinor(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(minor / 10 ** exp);
  } catch {
    return `${currency} ${(minor / 10 ** exp).toFixed(exp)}`;
  }
}

/** The symbol to show before the big number while typing (falls back to the code). */
export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Frankfurter gives units of the currency per 1 GBP; the app stores GBP per 1 unit (8 dp). */
export function gbpPerUnit(unitsPerGbp: number | string): string {
  const x = scaleRate(typeof unitsPerGbp === "number" ? unitsPerGbp : unitsPerGbp);
  if (x === 0n) throw new Error("Zero rate");
  return rateString(divHalfEven(pow10(RATE_SCALE) * pow10(RATE_SCALE), x));
}

/** The keypad for a foreign amount: decimals follow the currency's exponent (JPY none, KWD three) and the amount stays a safe integer of minor units. */
export function pressKeyFx(current: string, key: string, currency: string): string {
  const exp = exponentOf(currency);
  if (key === "back") return current.slice(0, -1);
  if (key === "clear") return "";
  if (key === ".") {
    if (exp === 0 || current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  if (!/^\d$/.test(key)) return current;
  const [whole = "", frac] = current.split(".");
  if (frac !== undefined) { if (frac.length >= exp) return current; }
  else if (whole === "0") return key === "0" ? current : key;
  const next = current + key;
  const minor = parseMinor(next, currency);
  return minor === null || minor > 99_999_999_999 ? current : next;
}
