// Server Actions return a result instead of throwing, so the UI can show the message inline.
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; retry?: boolean };
export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
/** `retry`: the failure is about the session or the network, not the data, so the outbox should try again later. */
export const fail = (error: string, retry = false): ActionResult<never> => (retry ? { ok: false, error, retry } : { ok: false, error });
const RETRYABLE = new Set(["28000", "42501", "PGRST301", "PGRST303", "PGRST000", "08006", "57P01"]);
export const isRetryableDbError = (e: { code?: string } | null | undefined) => !!e?.code && RETRYABLE.has(e.code);

/** Map a Postgres/PostgREST error to words a person can act on. */
export function friendlyDbError(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? "Something went wrong.";
  if (e?.code === "23505") return "That already exists.";
  if (e?.code === "23503") return "That is still in use by other records.";
  if (e?.code === "42501") return "You are not allowed to do that. Try signing in again.";
  // Our own RAISE EXCEPTION texts are written for people already.
  if (e?.code === "23514" || e?.code === "P0001" || e?.code === "02000") return m;
  return m.length < 160 ? m : "Something went wrong. Please try again.";
}
