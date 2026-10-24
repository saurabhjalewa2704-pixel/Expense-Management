import { pctOf } from "@/lib/money";

// One hue, lighter to darker by rank (all tokens): ink, ink-2, ink-3, then the two context greys.
const SHADES = ["var(--ink)", "var(--ink-2)", "var(--ink-3)", "var(--chart-context)", "var(--surface-3)"];
export interface Share { key: string; label: string; pence: number }

/** The segments of a 100% bar: at most five, with anything smaller folded into the last one. */
export function shareSegments(parts: readonly Share[], max = 5): Share[] {
  const sorted = [...parts].filter((p) => p.pence > 0).sort((a, b) => b.pence - a.pence);
  if (sorted.length <= max) return sorted;
  const rest = sorted.slice(max - 1);
  return [...sorted.slice(0, max - 1), { key: "rest", label: "Everything else", pence: rest.reduce((s, p) => s + p.pence, 0) }];
}
const short = (label: string) => label.split(/\s|&/)[0] || label;

/** AN-07: a 100% share bar in a single hue with a legend that gives each segment's percentage. */
export function ShareBar({ parts }: { parts: readonly Share[] }) {
  const segs = shareSegments(parts);
  const total = segs.reduce((s, p) => s + p.pence, 0);
  if (!total) return null;
  return (
    <>
      <div className="share-bar" role="img" data-testid="share-bar" aria-label={segs.map((s) => `${s.label} ${pctOf(s.pence, total)}%`).join(", ")}>
        {segs.map((s, i) => <i key={s.key} style={{ width: `${(s.pence / total) * 100}%`, background: SHADES[i] }} />)}
      </div>
      <div className="share-legend">
        {segs.map((s, i) => <span key={s.key}><i style={{ background: SHADES[i] }} />{short(s.label)} {pctOf(s.pence, total)}%</span>)}
      </div>
    </>
  );
}
