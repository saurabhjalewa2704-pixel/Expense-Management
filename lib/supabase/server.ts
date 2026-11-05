import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serviceRoleKey, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Server client acting as the signed-in user (Server Components, Server Actions, route handlers). RLS applies. */
export async function supabaseServer(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it sees every person's rows. Use it only for work that is the same for everyone (rates,
 * purging) or that names the user in every query. Anything that runs the app's SQL functions or reads tables "as the user" must
 * use supabaseAsUser instead, or one person's figures would include the other's. Never import this from client code.
 */
export function supabaseService(): SupabaseClient {
  return createSupabaseClient(supabaseUrl(), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * A client that acts as one person, with row-level security applying exactly as in their own session, for cron jobs that work
 * through everyone in turn. The service role bypasses RLS and the SQL functions rely on it for scoping, so jobs must not run
 * them as the service role once there is more than one person. A short-lived session is minted through the Auth admin API
 * (a one-time sign-in link for the person, redeemed straight away); no password or extra secret is needed and nothing is e-mailed.
 */
export async function supabaseAsUser(userId: string): Promise<SupabaseClient> {
  const admin = supabaseService();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (findError || !email) throw new Error(`supabaseAsUser: no e-mail for ${userId}: ${findError?.message ?? "unknown user"}`);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) throw new Error(`supabaseAsUser: could not start a session for ${userId}: ${linkError?.message ?? "no token"}`);
  const anon = createSupabaseClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  // the token type was renamed in newer Auth versions ("magiclink" -> "email"); a link token is only used up by a successful redeem
  let token: string | undefined, why = "no session";
  for (const type of ["magiclink", "email"] as const) {
    const { data: session, error } = await anon.auth.verifyOtp({ token_hash: hashed, type });
    token = session?.session?.access_token;
    if (token) break;
    why = error?.message ?? why;
  }
  if (!token) throw new Error(`supabaseAsUser: could not open a session for ${userId}: ${why}`);
  return createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
