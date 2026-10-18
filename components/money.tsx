import { formatGBP, splitGBP, type FormatOptions, type Pence } from "@/lib/money";

/** Spend renders in ink and income in the positive colour with a "+" (PRD §14: spend is never red). */
export function Amount({ pence, income, className }: { pence: Pence; income?: boolean; className?: string }) {
  return <span className={`num ${income ? "pos" : ""} ${className ?? ""}`}>{formatGBP(pence, { signed: income } as FormatOptions)}</span>;
}

/** The signature figure: a very large tabular number with the pence lighter and smaller. */
export function Figure({ pence, xl }: { pence: Pence; xl?: boolean }) {
  const f = splitGBP(pence);
  return (
    <div className={`figure ${xl ? "xl" : ""}`} aria-label={formatGBP(pence)}>
      {f.sign && <span className="cur" aria-hidden>{f.sign}</span>}
      <span className="cur" aria-hidden>£</span>
      <span className="whole" aria-hidden>{f.whole}</span>
      <span className="pence" aria-hidden>.{f.pence}</span>
    </div>
  );
}
