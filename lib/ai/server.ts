import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TZDate } from "@date-fns/tz";
import { LONDON, monthStart, todayLondon, type ISODate } from "@/lib/dates";
import { generateInsights, type InsightRunRow } from "./generate";
import type { Facts } from "./types";
import { anthropicWriter, type CardWriter } from "./writer";

export const ADHOC_PER_DAY = 10;

/** The real writer when ANTHROPIC_API_KEY is set; otherwise null, and digests use the deterministic template cards. */
export function configuredWriter(): CardWriter | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? anthropicWriter(key) : null;
}

/** London today. STERLING_TEST_TODAY pins it for the E2E run, whose demo data is dated to a fixed day. */
export const serverToday = (): ISODate => (process.env.STERLING_TEST_TODAY as ISODate | undefined) ?? todayLondon();

export const tokenCap = (): number => Number(process.env.AI_MONTHLY_TOKEN_CAP ?? 500_000);

const londonMidnight = (d: ISODate) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new TZDate(y, m - 1, day, LONDON).toISOString();
};

/** Tokens used this calendar month (London), summed from insight_runs (PRD §12.6). */
export async function tokensUsedThisMonth(db: SupabaseClient, userId: string, today: ISODate = serverToday()): Promise<number> {
  const { data } = await db.from("insight_runs").select("input_tokens,output_tokens").eq("user_id", userId).gte("created_at", londonMidnight(monthStart(today)));
  return ((data ?? []) as { input_tokens: number | null; output_tokens: number | null }[]).reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
}

export async function adhocRunsToday(db: SupabaseClient, userId: string, today: ISODate = serverToday()): Promise<number> {
  const { count } = await db.from("insight_runs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("scope", "adhoc").gte("created_at", londonMidnight(today));
  return count ?? 0;
}

export async function runDigest(db: SupabaseClient, userId: string, scope: Facts["scope"], opts: { includeNotes?: boolean; today?: ISODate } = {}): Promise<InsightRunRow> {
  const today = opts.today ?? serverToday();
  return generateInsights({
    db, userId, scope, today, writer: configuredWriter(), includeNotes: opts.includeNotes,
    usedTokens: await tokensUsedThisMonth(db, userId, today), tokenCap: tokenCap(),
    log: (message, data) => console.warn(`[insights] ${message}`, data ?? ""),
  });
}
