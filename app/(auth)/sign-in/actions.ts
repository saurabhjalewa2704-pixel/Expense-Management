"use server";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action";
import { allowedEmail } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

const Email = z.string().trim().toLowerCase().pipe(z.email());
const Code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");

/** AUTH-01: only the owner's e-mail may be sent a code; the allow-list is checked here, before Supabase is called. */
export async function requestCode(email: string): Promise<ActionResult> {
  const parsed = Email.safeParse(email);
  if (!parsed.success) return fail("Enter a valid e-mail address.");
  if (parsed.data !== allowedEmail()) return fail("That address can't sign in to this app.");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: false } });
  if (error) {
    if (error.code === "otp_disabled" || /signups not allowed/i.test(error.message)) {
      return fail("This account hasn't been created yet. Run the owner bootstrap script (see the README), then try again.");
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit") return fail("Too many attempts. Wait a minute and try again.");
    return fail("We couldn't send a code. Please try again.");
  }
  return ok(undefined);
}

export async function verifyCode(email: string, code: string): Promise<ActionResult> {
  const e = Email.safeParse(email);
  const c = Code.safeParse(code);
  if (!e.success || e.data !== allowedEmail()) return fail("That address can't sign in to this app.");
  if (!c.success) return fail(c.error.issues[0]?.message ?? "Enter the 6-digit code.");

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email: e.data, token: c.data, type: "email" });
  if (error || !data.user) return fail("That code isn't right, or it has expired.");
  if (data.user.email?.toLowerCase() !== allowedEmail()) {
    await supabase.auth.signOut();
    return fail("That address can't sign in to this app.");
  }
  return ok(undefined);
}

/** E-mail + password sign-in. Needs no e-mail delivery, so it works on Supabase's built-in sender. Same allow-list, checked first. */
export async function signInWithPassword(email: string, password: string): Promise<ActionResult> {
  const e = Email.safeParse(email);
  if (!e.success) return fail("Enter a valid e-mail address.");
  if (e.data !== allowedEmail()) return fail("That address can't sign in to this app.");
  if (!password) return fail("Enter your password.");

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email: e.data, password });
  if (error || !data.user) {
    if (error?.status === 429 || error?.code === "over_request_rate_limit") return fail("Too many attempts. Wait a minute and try again.");
    return fail("That e-mail or password isn't right.");
  }
  if (data.user.email?.toLowerCase() !== allowedEmail()) {
    await supabase.auth.signOut();
    return fail("That address can't sign in to this app.");
  }
  return ok(undefined);
}

export async function signOut(): Promise<ActionResult> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "global" });
  return ok(undefined);
}
