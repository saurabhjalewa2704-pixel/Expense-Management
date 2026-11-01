"use client";
// One-off expenses (§6.14.3, mock-up F5): a chip on the row, and a switch in the editor. A one-off counts in what you've spent, never in the daily pace.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { setOneOff } from "@/app/actions/forecast";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

/** The ids of every one-off expense (a small set), so rows can show the chip without a new column on the Activity query. */
export function useOneOffIds() {
  return useQuery({
    queryKey: ["one-offs"],
    queryFn: async () => {
      const { data } = await supabaseBrowser().from("transactions").select("id").eq("is_one_off", true).is("deleted_at", null);
      return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    },
    staleTime: 30_000,
  });
}

export function OneOffChip({ id }: { id: string }) {
  const q = useOneOffIds();
  if (!q.data?.has(id)) return null;
  return <span className="pill" data-testid="one-off-chip" style={{ height: 20, fontSize: 11, marginLeft: 6, padding: "0 7px", verticalAlign: "1px" }}>One-off</span>;
}

/** The switch in the expense editor, with why it was flagged. */
export function OneOffBlock({ id, category }: { id: string; category?: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [row, setRow] = useState<{ on: boolean; source: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    void supabaseBrowser().from("transactions").select("is_one_off, one_off_source").eq("id", id).maybeSingle().then(({ data }) => {
      if (live) setRow({ on: !!(data as { is_one_off: boolean | null } | null)?.is_one_off, source: (data as { one_off_source: string | null } | null)?.one_off_source ?? null });
    });
    return () => { live = false; };
  }, [id]);
  if (!row) return null;
  const flip = async (v: boolean) => {
    setRow({ on: v, source: "user" });
    const r = await setOneOff(id, v);
    if (!r.ok) { toast({ message: r.error }); setRow({ on: !v, source: row.source }); return; }
    await qc.invalidateQueries();
  };
  return (
    <div style={{ marginTop: 12 }} data-testid="one-off-block">
      <div className="row-between" style={{ background: "var(--surface)", borderRadius: 16, padding: "12px 16px", gap: 12 }}>
        <div><div style={{ fontSize: 17 }}>One-off</div><div className="sub" style={{ fontSize: 13, marginTop: 2 }}>Counts in what you’ve spent, not in your daily pace</div></div>
        <Switch checked={row.on} onChange={flip} label="One-off" />
      </div>
      {row.on && row.source === "auto" && (
        <p className="sub" style={{ margin: "10px 4px 0", lineHeight: 1.45 }} data-testid="one-off-why">
          Sterling flagged this because it’s much larger than a typical {category ?? "spend"} (over £150 and more than 5× the usual ticket). Without the flag, one big purchase would inflate this month’s forecast and your usual for months to come. Turn it off if it’s part of your normal spending.
        </p>
      )}
    </div>
  );
}
