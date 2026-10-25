import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Body = z.object({ occurrence: z.string().uuid(), action: z.enum(["confirm", "log", "skip"]), amount_pence: z.number().int().positive().optional() });

/** REC-05: the notification buttons ("Looks right", "Log it", "Skip"). The service worker calls it with the session cookie. */
export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const db = await supabaseServer();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await db.rpc("recurring_resolve", { p_occurrence: body.data.occurrence, p_action: body.data.action, p_amount: body.data.amount_pence ?? null });
  return error ? NextResponse.json({ error: error.message }, { status: 409 }) : NextResponse.json({ ok: true });
}
