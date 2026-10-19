import { NextResponse } from "next/server";
import { serverToday } from "@/lib/ai/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The notification's "Nothing to log" action: a genuine zero-spend day, not a missed one (NOT-01). Uses the session cookie. */
export async function POST() {
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await db.from("no_spend_days").upsert({ user_id: u.user.id, day: serverToday() }, { onConflict: "user_id,day", ignoreDuplicates: true });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
