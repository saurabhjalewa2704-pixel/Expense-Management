import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { toPence } from "@/lib/money";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * CAP-08: `POST /api/v1/capture` with `Authorization: Bearer <token>` and `{ amount, payee?, category?, account?, note?, occurred_at? }`.
 * Tokens are stored as a hash; a revoked token is refused at once (EC-P6); 60 captures an hour per token.
 */
export async function POST(req: NextRequest) {
  const bearer = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!bearer) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  const db = supabaseService();
  const hash = createHash("sha256").update(bearer).digest("hex");
  const { data: hit } = await db.rpc("api_token_hit", { p_hash: hash });
  const row = (hit as { user_id: string | null; status: string }[] | null)?.[0];
  if (!row || row.status === "unauthorised") return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  if (row.status === "rate_limited") return NextResponse.json({ error: "Too many captures. Try again later." }, { status: 429, headers: { "retry-after": "3600" } });

  const b = (await req.json().catch(() => null)) as { amount?: number | string; payee?: string; category?: string; account?: string; note?: string; occurred_at?: string } | null;
  const pence = b?.amount !== undefined ? toPence(String(b.amount)) : null;
  if (!pence || pence <= 0) return NextResponse.json({ error: "amount must be a positive amount in pounds" }, { status: 400 });
  const at = b?.occurred_at && !Number.isNaN(Date.parse(b.occurred_at)) ? new Date(b.occurred_at).toISOString() : null;
  const { data, error } = await db.rpc("capture_expense", {
    p_user: row.user_id, p_amount: pence, p_payee: b?.payee?.trim() || null, p_category: b?.category?.trim() || null,
    p_account: b?.account?.trim() || null, p_note: b?.note?.trim() || null, p_at: at,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "P0002" ? 422 : 500 });
  return NextResponse.json({ id: data }, { status: 201 });
}
