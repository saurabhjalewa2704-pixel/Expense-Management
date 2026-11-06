"use client";
// Month close answers go through a small queue of their own next to the transaction outbox (MC-06, EC-MC27): every answer is saved at once when
// online, and kept on the device until it reaches the server when not. The server functions are idempotent per item (last write wins), so a
// replay can never double anything. Only answers queue; reconciling an account and closing the month need a connection.
import type { SupabaseClient } from "@supabase/supabase-js";
import { del, get, set } from "idb-keyval";

export type CloseFn = "close_answer" | "close_answer_days" | "close_resolve_bill" | "close_set_step";
export interface QueuedCall { id: string; fn: CloseFn; args: Record<string, unknown>; at: number }
const KEY = "sterling-close-queue";
const EVENT = "sterling:close-queue";

const read = async (): Promise<QueuedCall[]> => (await get<QueuedCall[]>(KEY).catch(() => undefined)) ?? [];
export const queuedCalls = read;
export async function queuedCount(): Promise<number> { return (await read()).length; }
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); };
export const watchCloseQueue = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); };

const looksOffline = (message: string) => (typeof navigator !== "undefined" && !navigator.onLine) || /failed to fetch|network|load failed|fetch failed/i.test(message);

/** Runs one call now; true when the server has it (or refused it for good), false when it should be kept for later. */
async function send(db: SupabaseClient, c: Pick<QueuedCall, "fn" | "args">): Promise<{ done: boolean; error?: string }> {
  try {
    const { error } = await db.rpc(c.fn, c.args);
    if (!error) return { done: true };
    if (looksOffline(error.message)) return { done: false, error: error.message };
    return { done: true, error: error.message };                 // a refusal (the month moved on, the item is gone): not worth keeping
  } catch (e) {
    return { done: false, error: String(e) };
  }
}

/** Save an answer: straight to the server, else into the queue. Returns an error only for a refusal. */
export async function saveCloseCall(db: SupabaseClient, fn: CloseFn, args: Record<string, unknown>): Promise<{ queued: boolean; error?: string }> {
  const r = await send(db, { fn, args });
  if (r.done) return { queued: false, error: r.error };
  const q = await read();
  q.push({ id: crypto.randomUUID(), fn, args, at: Date.now() });
  await set(KEY, q).catch(() => undefined);
  notify();
  return { queued: true };
}

/** Replays the queue in order; stops at the first call that still cannot get through. */
export async function flushCloseQueue(db: SupabaseClient): Promise<number> {
  const q = await read();
  if (!q.length) return 0;
  let sent = 0;
  const rest: QueuedCall[] = [];
  for (let i = 0; i < q.length; i++) {
    const r = await send(db, q[i]!);
    if (!r.done) { rest.push(...q.slice(i)); break; }
    sent++;
  }
  if (rest.length) await set(KEY, rest).catch(() => undefined); else await del(KEY).catch(() => undefined);
  if (sent) notify();
  return sent;
}
