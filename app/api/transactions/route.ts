import { NextResponse, type NextRequest } from "next/server";
import { createTransactionWith } from "@/lib/transactions-write";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * CAP-05: where the offline outbox sends a captured entry. The same write as the createTransaction Server Action, on a URL that does not
 * change between builds: a Server Action id is different in every build, so a phone still running the previous version (a cached
 * app that has not been refreshed yet) was refused by the new server and its entries waited, unsent and unexplained, until it updated.
 * Idempotent on (user, client_id). Always answers JSON: { ok, data } or { ok: false, error, retry? }.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "That entry couldn't be read." }, { status: 400 }); }
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "You're signed out. Sign in again to send it.", retry: true }, { status: 401 });
  return NextResponse.json(await createTransactionWith(db, body));
}
