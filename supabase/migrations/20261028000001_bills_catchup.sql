-- Bills: two timestamps so the app can say whether automatic logging is working.
--   bills_cron_at     the scheduled job (Vercel or pg_cron) last ran
--   bills_checked_at  the app itself last caught up on due bills when it was opened
alter table profiles add column bills_cron_at timestamptz;
alter table profiles add column bills_checked_at timestamptz;
