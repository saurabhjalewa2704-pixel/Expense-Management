"use client";
import Link from "next/link";
import { PotRow } from "@/components/pots/pots-screen";
import { usePots } from "@/lib/queries/hooks";

/** Open one-off pots, only once one exists. They are tracked here, not in monthly spend. */
export function PotsSection() {
  const pots = (usePots().data ?? []).filter((p) => !p.closed_at);
  if (pots.length === 0) return null;
  return (
    <section aria-label="One-off pots" data-testid="pots-section">
      <div className="section-h"><h2>One-off pots</h2><Link className="link" href="/pots">See all</Link></div>
      <div className="list">{pots.slice(0, 3).map((p) => <PotRow key={p.pot_id} pot={p} />)}</div>
    </section>
  );
}
