// Creates the people who may sign in (sign-ups are disabled). Run once, with the service-role key, after the migrations:
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ALLOWED_EMAIL=you@example.com,partner@example.com node scripts/bootstrap-owner.mjs
// ALLOWED_EMAIL may list several addresses separated by commas. Each one gets an account; the database trigger then creates
// that person's profile (and, for the first person only, the shared 69-category taxonomy). Safe to re-run: existing users are skipped.
// Users added by hand in the Supabase dashboard work just as well; this script is only for people without a dashboard.
import { createClient } from "@supabase/supabase-js";

const need = (k) => process.env[k] || (console.error(`Missing ${k}`), process.exit(1));
const emails = [...new Set(need("ALLOWED_EMAIL").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const { data: existing, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listError) { console.error(listError.message); process.exit(1); }
const have = new Set(existing.users.map((u) => u.email?.toLowerCase()));
const stray = existing.users.filter((u) => !emails.includes(u.email?.toLowerCase() ?? ""));
if (stray.length) console.warn(`Note: ${stray.map((u) => u.email).join(", ")} exist in Supabase but are not in ALLOWED_EMAIL, so they cannot sign in.`);

for (const email of emails) {
  if (have.has(email)) { console.log(`${email} already exists. Skipped.`); continue; }
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) { console.error(`${email}: ${error.message}`); process.exit(1); }
  console.log(`Created ${email} (${data.user.id}). They can sign in with the e-mailed code, or you can set a password in the Supabase dashboard.`);
}
const { count } = await db.from("categories").select("id", { count: "exact", head: true });
console.log(`The shared category list has ${count} categories.`);
