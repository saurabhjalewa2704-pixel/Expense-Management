// Environment access in one place, with readable errors instead of "undefined is not a function".

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

// NEXT_PUBLIC_* must be referenced literally so Next can inline them into the client bundle.
export const supabaseUrl = () => need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = () => need("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Server only.
export const serviceRoleKey = () => need("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
export const allowedEmail = () => need("ALLOWED_EMAIL", process.env.ALLOWED_EMAIL).trim().toLowerCase();
export const cronSecret = () => need("CRON_SECRET", process.env.CRON_SECRET);

export const APP_NAME = "Sterling";
