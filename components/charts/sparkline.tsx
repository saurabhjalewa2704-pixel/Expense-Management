/** A tiny line for a series of integer pence: ink on the dark ground, an end dot, no axes (ACC-04). */
export function Sparkline({ values, height = 56, label }: { values: number[]; height?: number; label: string }) {
  if (values.length < 2) return <div className="sub" style={{ height }}>Not enough history yet.</div>;
  const w = 320, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={label} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      <path d={`${d} L${last[0]},${height} L${pts[0]![0]},${height} Z`} fill="var(--chart-fill)" />
      <path d={d} fill="none" stroke="var(--chart-ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--chart-ink)" />
    </svg>
  );
}
