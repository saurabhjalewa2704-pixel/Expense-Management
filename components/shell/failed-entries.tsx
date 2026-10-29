"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useBannerSpace } from "./banner-space";
import { useQuickAdd } from "@/components/capture/quick-add";
import { UI } from "@/lib/icons";
import { discard } from "@/lib/outbox";
import { pendingRow } from "@/lib/overlay";
import { useAccounts, useCategories, useOutbox, usePots } from "@/lib/queries/hooks";
import { formatGBP } from "@/lib/money";

/**
 * An entry the server refused used to vanish: the optimistic row disappeared and the balance went back, with no word.
 * Now it stays here, with the server's reason, until it is fixed or discarded.
 */
export function FailedEntries() {
  const items = useOutbox().filter((i) => i.status === "failed");
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const pots = usePots().data ?? [];
  const { open } = useQuickAdd();
  const qc = useQueryClient();
  const item = items[0];
  const box = useRef<HTMLDivElement>(null);
  useBannerSpace(box, !!item);
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
