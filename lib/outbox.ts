"use client";
// CAP-05: the offline outbox. Every capture is written here first (IndexedDB via Dexie), shown optimistically
// everywhere, then flushed to the server. The server upserts on client_id, so retries are idempotent.
// iOS Safari has no Background Sync, so flushing is driven by launch, `online` and `visibilitychange` (lib/sync.tsx).
import Dexie, { liveQuery, type Table } from "dexie";
import { v7 as uuidv7 } from "uuid";
import { recalcIfNewer } from "@/lib/fx-client";
import type { TxnInput } from "@/lib/schemas/transaction";

export interface OutboxItem {
  client_id: string;
  created_at: number;
  /** pending: waiting for the server · failed: the server refused it (needs the user's attention). */
  status: "pending" | "failed";
  attempts: number;
  error?: string;
  /** Why the last send did not go through while the entry is still waiting (the server answered badly, or the session ended); offline is not an error. */
  last_error?: string;
  /** The server accepted it at this time; hidden from views once a refetch is newer than this. */
  confirmed_at?: number;
  payload: TxnInput;
  /** Optimistic balance flags (BAL-03) so offline balances match what the server will compute: the account side and the receiving side. */
  flags?: { a: boolean; b: boolean | null };
  /** The account's card fee in basis points, kept so a foreign-currency entry can be recalculated when it syncs (TRIP-06). */
  fee_bps?: number;
}

class SterlingDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  constructor() {
    super("sterling");
    this.version(1).stores({ outbox: "client_id, created_at, status" });
  }
}

let instance: SterlingDB | undefined;
const db = () => (instance ??= new SterlingDB());

export const newClientId = () => uuidv7();

export async function enqueue(payload: TxnInput, flags?: OutboxItem["flags"], fee_bps?: number): Promise<OutboxItem> {
  const item: OutboxItem = { client_id: payload.client_id, created_at: Date.now(), status: "pending", attempts: 0, payload, flags, fee_bps };
  await db().outbox.put(item);
  return item;
}

export const getOutbox = () => db().outbox.orderBy("created_at").toArray();
/** Edit an entry that has not reached the server yet. */
export const updatePending = (clientId: string, payload: TxnInput) => db().outbox.update(clientId, { payload, status: "pending", error: undefined });
export const getItem = (clientId: string) => db().outbox.get(clientId);
export const discard = (clientId: string) => db().outbox.delete(clientId);
export const retryFailed = (clientId: string) => db().outbox.update(clientId, { status: "pending", error: undefined });

/** Subscribe to every change in the outbox (Dexie liveQuery). Returns an unsubscribe function. */
export function watchOutbox(cb: (items: OutboxItem[]) => void): () => void {
  const sub = liveQuery(() => db().outbox.orderBy("created_at").toArray()).subscribe({ next: cb, error: () => cb([]) });
  return () => sub.unsubscribe();
}

export interface FlushResult {
  /** Items the server accepted during this flush. */
  confirmed: number;
  /** The network (or the session) stopped the flush; try again later. */
  blocked: boolean;
}

let inflight: Promise<FlushResult> | null = null;
/** Resolves when no flush is running (used by Undo so it cannot race a send in flight). */
export const flushIdle = async (): Promise<void> => { await inflight?.catch(() => {}); };

/** Send pending items oldest-first. One flush at a time per tab, and one per browser via Web Locks where available. */
export function flushOutbox(): Promise<FlushResult> {
  inflight ??= (async () => {
    const run = () => doFlush();
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const r = locks
      ? await locks.request("sterling-outbox-flush", { ifAvailable: true }, (lock) => (lock ? run() : { confirmed: 0, blocked: true }))
      : await run();
    return r as FlushResult;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** How long one send may take before it is abandoned and retried. */
export const SEND_TIMEOUT_MS = 20_000;

type Sent = { kind: "ok" } | { kind: "refused"; error: string } | { kind: "retry"; error?: string };

/** One entry to POST /api/transactions. A network failure is "offline" (no reason to show); anything the server answers badly is reported. */
async function sendTransaction(p: TxnInput): Promise<Sent> {
  let r: Response;
  // A request that never answers (an iPhone suspends the app mid-request, a connection dies silently) must not hold the flush, and the lock
  // that guards it, for ever: every later entry would wait behind it. Past the limit it is abandoned and sent again; the server ignores a repeat.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);
  try {
    r = await fetch("/api/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p), credentials: "same-origin", redirect: "manual", cache: "no-store", signal: ac.signal });
  } catch {
    // the request never reached the server (offline: nothing to say), or it did not answer in time (online: say so)
    return { kind: "retry", error: ac.signal.aborted && typeof navigator !== "undefined" && navigator.onLine ? "The server didn't answer in time." : undefined };
  } finally { clearTimeout(timer); }
  if (r.type === "opaqueredirect" || r.status === 401) return { kind: "retry", error: "You're signed out. Open Settings and sign in again to send it." };
  let j: { ok?: boolean; error?: string; retry?: boolean } | undefined;
  try { j = (await r.json()) as typeof j; } catch { /* not JSON: a gateway or an error page */ }
  if (j?.ok) return { kind: "ok" };
  if (j && j.ok === false && !j.retry && r.status < 500) return { kind: "refused", error: j.error ?? "The server refused it." };
  return { kind: "retry", error: j?.error ?? `The server couldn't take it just now (${r.status}).` };
}

async function doFlush(): Promise<FlushResult> {
  const rows = (await db().outbox.where("status").equals("pending").sortBy("created_at")).filter((r) => !r.confirmed_at);
  let confirmed = 0;
  for (const row of rows) {
    let res: Sent;
    try {
      const payload = await recalcIfNewer(row.payload, row.fee_bps ?? 0);
      if (payload !== row.payload) await db().outbox.update(row.client_id, { payload });
      res = await sendTransaction(payload);
    } catch {
      return { confirmed, blocked: true }; // offline: the request never reached the server
    }
    if (res.kind === "ok") {
      await db().outbox.update(row.client_id, { confirmed_at: Date.now(), last_error: undefined });
      confirmed += 1;
    } else if (res.kind === "retry") {
      // keep the reason, so a send that keeps failing is shown to the person rather than retried in silence
      if (res.error) await db().outbox.update(row.client_id, { last_error: res.error, attempts: row.attempts + 1 });
      return { confirmed, blocked: true };
    } else {
      await db().outbox.update(row.client_id, { status: "failed", error: res.error, attempts: row.attempts + 1 });
    }
  }
  return { confirmed, blocked: false };
}

/** Once every active query has refetched, the confirmed rows are no longer needed. */
export async function purgeConfirmed(): Promise<void> {
  const ids = (await db().outbox.toArray()).filter((r) => r.confirmed_at).map((r) => r.client_id);
  if (ids.length) await db().outbox.bulkDelete(ids);
}
