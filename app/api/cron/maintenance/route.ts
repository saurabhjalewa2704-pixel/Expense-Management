import { NextResponse, type NextRequest } from "next/server";
import { cronSecret } from "@/lib/env";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Daily housekeeping: soft-deleted transactions older than 30 days are removed for good (CAP-01). It also keeps a free Supabase project awake. */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data, error } = await supabaseService().rpc("purge_deleted_transactions");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purged: data });
}
