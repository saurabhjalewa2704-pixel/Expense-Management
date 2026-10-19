import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { allowedEmail, supabaseAnonKey, supabaseUrl } from "@/lib/env";

// Routes that authenticate themselves (bearer secrets) or must load before sign-in.
const PUBLIC = [/^\/sign-in/, /^\/api\/cron\//, /^\/api\/v1\//, /^\/serwist\//, /^\/manifest\.webmanifest$/, /^\/(icon|apple-icon)/, /^\/offline$/];

/**
 * Refreshes the Supabase session cookie on every request and gates the app (AUTH-01):
 * signed-out visitors go to /sign-in, and only ALLOWED_EMAIL may stay signed in.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((re) => re.test(pathname));

  const redirect = (to: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = search;
    const r = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (user && user.email?.toLowerCase() !== allowedEmail()) {
    await supabase.auth.signOut();
    return redirect("/sign-in", "?error=not-allowed");
  }
  if (!user && !isPublic) return redirect("/sign-in", pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`);
  if (user && pathname.startsWith("/sign-in")) return redirect("/");
  return response;
}
