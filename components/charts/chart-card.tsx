"use client";
import { useId, useState, type ReactNode } from "react";

export interface TableData { columns: string[]; rows: (string | number)[][] }

/**
 * Every chart: a finding title (a sentence stating the insight), a quieter subtitle with units and period, the chart,
 * and a "View as table" alternative (WCAG: charts provide a table). Skeleton and empty states are handled by the caller.
 */
export function ChartCard({ finding, sub, children, table, testId, loading, empty, emptyText, emptyAction, actions }: {
  finding: string; sub?: string; children: ReactNode; table?: TableData; testId?: string; loading?: boolean; empty?: boolean; emptyText?: string; emptyAction?: ReactNode; actions?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className="card chart-card" data-testid={testId} aria-labelledby={`${id}-t`}>
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 id={`${id}-t`} className="finding">{loading ? "Loading…" : finding}</h2>
          {sub && <div className="finding-sub">{sub}</div>}
        </div>
        {actions}
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 160, marginTop: 16 }} aria-busy />
      ) : empty ? (
        <div style={{ marginTop: 16, padding: "24px 0", textAlign: "center" }} data-testid="chart-empty"><p className="sub">{emptyText ?? "Nothing to show for this period yet."}</p>{emptyAction && <div style={{ marginTop: 10 }}>{emptyAction}</div>}</div>
      ) : asTable && table ? (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{table.columns.map((c, i) => <th key={c} scope="col" style={{ textAlign: i ? "right" : "left", padding: "6px 0", color: "var(--ink-3)", fontWeight: 600, fontSize: 12 }}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--rule)" }}>{r.map((c, j) => <td key={j} className="num" style={{ textAlign: j ? "right" : "left", padding: "7px 0 7px " + (j ? 12 : 0) + "px" }}>{c}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : children}
      {table && !loading && !empty && (
        <button className="link" style={{ marginTop: 12, fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? "View as chart" : "View as table"}
        </button>
      )}
    </section>
  );
}
