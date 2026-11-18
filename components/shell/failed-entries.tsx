"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useBannerSpace } from "./banner-space";
import { useQuickAdd } from "@/components/capture/quick-add";
import { UI } from "@/lib/icons";
import { discard } from "@/lib/outbox";
import { requestSync } from "@/lib/sync";
import { pendingRow } from "@/lib/overlay";
import { useAccounts, useCategories, useOutbox, usePots } from "@/lib/queries/hooks";
import { formatGBP } from "@/lib/money";

/**
 * An entry the server refused used to vanish: the optimistic row disappeared and the balance went back, with no word.
 * Now it stays here, with the server's reason, until it is fixed or discarded.
 */
export function FailedEntries() {
  const all = useOutbox();
  const items = all.filter((i) => i.status === "failed");
  const stuck = all.filter((i) => i.status === "pending" && !i.confirmed_at && i.last_error);
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const pots = usePots().data ?? [];
  const { open } = useQuickAdd();
  const qc = useQueryClient();
  const item = items[0];
  const box = useRef<HTMLDivElement>(null);
  useBannerSpace(box, !!item || stuck.length > 0);
  if (!item && stuck.length > 0) {
    // not refused, just not sent: the server answered badly or the session ended. Say why instead of showing "Waiting" with no explanation.
    return (
      <div ref={box} role="status" className="failed-banner" data-testid="stuck-entry">
        <UI.CloudUpload size={16} strokeWidth={2} aria-hidden />
        <div className="msg"><b>{stuck.length > 1 ? `${stuck.length} entries haven’t been sent yet.` : "An entry hasn’t been sent yet."}</b> {stuck[0]!.last_error} It’s saved on this phone and will keep trying.</div>
        <button className="go" onClick={() => requestSync()}>Try now</button>
      </div>
    );
  }
  if (!item) return null;
  const p = item.payload;
  const label = `${formatGBP(p.amount_pence)}${p.payee ? ` · ${p.payee}` : ""} (${p.occurred_on.split("-").reverse().join("/")})`;
  return (
    <div ref={box} role="alert" className="failed-banner" data-testid="failed-entry">
      <UI.Info size={16} strokeWidth={2} aria-hidden />
      <div className="msg"><b>{items.length > 1 ? `${items.length} entries weren’t saved.` : "An entry wasn’t saved."}</b> {label}: {item.error ?? "the server refused it."}</div>
      <button className="go" onClick={() => open({ edit: pendingRow(item, accounts, categories, pots) })}>Fix</button>
      <button className="x" aria-label="Discard this entry" onClick={async () => { await discard(item.client_id); await qc.invalidateQueries(); }}><UI.X size={16} strokeWidth={2} aria-hidden /></button>
    </div>
  );
}
