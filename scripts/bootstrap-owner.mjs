// Creates the one user who may sign in (sign-ups are disabled). Run once, with the service-role key, after the migrations:
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ALLOWED_EMAIL=you@example.com node scripts/bootstrap-owner.mjs
// The database trigger then creates the profile and seeds the 69-category taxonomy. Safe to re-run.
import { createClient } from "@supabase/supabase-js";

const need = (k) => process.env[k] || (console.error(`Missing ${k}`), process.exit(1));
const email = need("ALLOWED_EMAIL").trim().toLowerCase();
const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const { data: existing, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listError) { console.error(listError.message); process.exit(1); }
if (existing.users.some((u) => u.email?.toLowerCase() === email)) { console.log(`${email} already exists. Nothing to do.`); process.exit(0); }
if (existing.users.length > 0) { console.error(`This project already has a different user (${existing.users[0].email}). Sterling is single-user; refusing to add a second.`); process.exit(1); }

const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
if (error) { console.error(error.message); process.exit(1); }
const { count } = await db.from("categories").select("id", { count: "exact", head: true }).eq("user_id", data.user.id);
console.log(`Created ${email} (${data.user.id}) with ${count} categories. Open the app and sign in with the e-mailed code.`);
