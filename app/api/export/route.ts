import { NextResponse, type NextRequest } from "next/server";
import { csvRow } from "@/lib/csv";
import { penceToDecimal } from "@/lib/money";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchActivityPage, type ActivityCursor } from "@/lib/queries/fetchers";
import type { ActivityFilters } from "@/lib/queries/keys";
import type { TxnRow } from "@/lib/types";

// AN-11: CSV of the filtered Activity list, or a full JSON backup. It runs as the signed-in user, so RLS applies.
export const dynamic = "force-dynamic";

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : undefined);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const format = p.get("format") === "json" ? "json" : "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const tables = ["profiles", "accounts", "categories", "payees", "transactions", "budgets", "recurring_rules", "no_spend_days"] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format: "sterling-backup-v1", money: "integer pence" };
    for (const t of tables) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(t).select("*").range(from, from + 999);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      out[t] = rows;
    }
    return new NextResponse(JSON.stringify(out, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="sterling-backup-${stamp}.json"`, "cache-control": "no-store" },
    });
  }

  const filters: ActivityFilters = {
    q: p.get("q") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined,
    accountIds: list(p.get("accounts")), categoryIds: list(p.get("categories")), types: list(p.get("types")),
  };
  const header = csvRow(["Date", "Type", "Amount (GBP)", "Account", "To account", "Category", "Sub-category", "Payee", "Note", "Tags", "Source", "ID"]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`﻿${header}\r\n`));
      let cursor: ActivityCursor | undefined;
      try {
        for (;;) {
          const rows: TxnRow[] = await fetchActivityPage(supabase, filters, cursor, 200);
          for (const r of rows) {
            const signed = r.type === "expense" ? -r.amount_pence : r.amount_pence;
            controller.enqueue(encoder.encode(csvRow([
              r.occurred_on, r.type, penceToDecimal(r.type === "transfer" ? r.amount_pence : signed), r.account_name, r.counter_account_name,
              r.parent_category_name ?? r.category_name, r.parent_category_name ? r.category_name : "", r.payee_name, r.note, r.tags.join(" "), r.source, r.id,
            ]) + "\r\n"));
          }
          const tail = rows[rows.length - 1];
          if (rows.length < 200 || !tail) break;
          cursor = { on: tail.occurred_on, created: tail.created_at, id: tail.id };
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new NextResponse(stream, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sterling-activity-${stamp}.csv"`, "cache-control": "no-store" },
  });
}
