import { formatGBP, splitGBP, type FormatOptions, type Pence } from "@/lib/money";

/** Spend renders in ink and income in the positive colour with a "+" (PRD §14: spend is never red). */
export function Amount({ pence, income, className }: { pence: Pence; income?: boolean; className?: string }) {
  return <span className={`num ${income ? "pos" : ""} ${className ?? ""}`}>{formatGBP(pence, { signed: income } as FormatOptions)}</span>;
}

/** The signature figure: a very large tabular number with the pence lighter and smaller. */
/** The big number's size in px for a figure with this many characters: it shrinks to stay on one line, never below 44px (EC-M6). */
export function figureSize(chars: number, base: number): number {
  const fit = chars <= 7 ? 1 : 7 / chars;
  return Math.max(44, Math.round(base * fit));
}

/** Overdrawn when the pool is below zero (EC-M5): the label changes and a caution dot sits beside the figure. */
export const cashLabel = (pence: Pence | undefined) => (pence !== undefined && pence < 0 ? "Overdrawn by" : "Available cash");

export function Figure({ pence, xl }: { pence: Pence; xl?: boolean }) {
  const f = splitGBP(pence);
  const size = figureSize(f.whole.length, xl ? 76 : 64);
  return (
    <div className={`figure ${xl ? "xl" : ""}`} aria-label={formatGBP(pence)} data-size={size} style={{ maxWidth: "100%", whiteSpace: "nowrap" }}>
      {f.sign && <span className="cur" aria-hidden>{f.sign}</span>}
      <span className="cur" aria-hidden>£</span>
      <span className="whole" aria-hidden style={{ fontSize: size }}>{f.whole}</span>
      <span className="pence" aria-hidden>.{f.pence}</span>
      {pence < 0 && <i className="caution-dot" aria-hidden data-testid="overdrawn-dot" />}
    </div>
  );
}
