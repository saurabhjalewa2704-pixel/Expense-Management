"use client";
// MC-71 / MC-72: a closed month's review, read-only, with what changed since the close, "Update the snapshot" and Reopen.
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { closeOnline, useCloseChanges, useCloseRow } from "@/lib/close/data";
import { closeUrl, monthFromParam, monthName } from "@/lib/close/logic";
import { isClosed } from "@/lib/close/types";
import { formatGBP } from "@/lib/money";
import { useCategoryTree, useToday } from "@/lib/queries/hooks";
import { ReviewBody, fromSnapshot } from "./review";

export function MonthReview({ param }: { param: string }) {
  const month = monthFromParam(param);
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const row = useCloseRow(month ?? "2000-01-01");
  const closed = isClosed(row.data?.status);
  const changed = !!row.data?.changed_since_close;
  const changes = useCloseChanges(month ?? "2000-01-01", closed && changed);
  const { tree } = useCategoryTree();
  const [busy, setBusy] = useState(false);
  if (!month) return null;
  const name = monthName(month);
  const act = async (fn: "update_close_snapshot" | "reopen_month", done: () => void) => {
    setBusy(true);
    const r = await closeOnline(fn, { p_month: month, p_today: today });
    setBusy(false);
    if (!r.ok) { toast({ message: r.error }); return; }
    await qc.invalidateQueries();
    done();
  };
  const sn = row.data?.snapshot;
  return (
    <div className="scroll" data-testid="month-review">
      <PageHeader title={`${name} ${month.slice(0, 4)}`} back="/settings/month-close" backLabel="Month close" />
      {!row.data && row.isFetched && <div className="card"><p className="sub">{name} hasn’t been closed yet.</p><Link href={closeUrl(month)} className="btn" style={{ marginTop: 12 }}>Close {name}</Link></div>}
      {row.data && !closed && <div className="card"><p className="sub">{name} is open. {row.data.status === "in_progress" ? "You started closing it." : ""}</p><Link href={closeUrl(month) + "?resume=1"} className="btn" style={{ marginTop: 12 }}>{row.data.status === "in_progress" ? "Continue" : "Start"}</Link></div>}
      {sn && closed && (
        <>
          {row.data?.status === "closed_quick" && <p className="sub" style={{ margin: "4px 2px" }}>Closed without review: the figures were taken as they stood.</p>}
          {changed && changes.data && (
            <div className="mc-item" data-testid="changed-since-close">
              <div className="eyebrow">Changed since close</div>
              <div className="mc-big" style={{ fontSize: "var(--t-title)", marginTop: 8 }} data-testid="changes-diff">{changes.data.difference >= 0 ? "+" : "−"}{formatGBP(Math.abs(changes.data.difference))} <span className="sub">in total spend</span></div>
              {changes.data.categories.length > 0 && <div style={{ marginTop: 10 }}>{changes.data.categories.map((c) => <div className="row-between sub" key={c.category_id}><span>{tree.byId.get(c.category_id)?.name ?? "Category"}</span><span>{formatGBP(c.before)} → {formatGBP(c.now)}</span></div>)}</div>}
              {changes.data.transactions.length > 0 && <div style={{ marginTop: 10 }}>{changes.data.transactions.map((t) => <div className="row-between sub" key={t.id}><span>{t.kind === "added" ? "Added" : t.kind === "deleted" ? "Deleted" : "Edited"} · {t.payee ?? "Entry"}</span><span>{formatGBP(t.amount_pence)}</span></div>)}</div>}
              <div className="mc-acts"><button className="mc-act on" data-testid="update-snapshot" disabled={busy} onClick={() => void act("update_close_snapshot", () => toast({ message: `${name}’s snapshot updated` }))}>Update the snapshot</button></div>
            </div>
          )}
          <ReviewBody d={fromSnapshot(sn)} ai={false} storedSummary={row.data?.summary ?? null} />
          <div className="mc-acts" style={{ marginTop: 20 }}><button className="btn secondary" data-testid="reopen" disabled={busy} onClick={() => void act("reopen_month", () => { window.location.assign(closeUrl(month)); })}>Reopen {name}</button></div>
          <p className="mc-note">Reopening keeps your earlier answers as the defaults. Closing again replaces the snapshot.</p>
        </>
      )}
    </div>
  );
}
