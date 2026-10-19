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
 * Service-role client. Bypasses RLS, so it is only for cron handlers, which iterate the single
 * owner explicitly and set user_id themselves (PRD §9.4). Never import this from client code.
 */
export function supabaseService(): SupabaseClient {
  return createSupabaseClient(supabaseUrl(), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
