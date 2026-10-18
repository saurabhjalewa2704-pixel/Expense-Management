"use client";
// CAP-05: the offline outbox. Every capture is written here first (IndexedDB via Dexie), shown optimistically
// everywhere, then flushed to the server. The server upserts on client_id, so retries are idempotent.
// iOS Safari has no Background Sync, so flushing is driven by launch, `online` and `visibilitychange` (lib/sync.tsx).
import Dexie, { liveQuery, type Table } from "dexie";
import { v7 as uuidv7 } from "uuid";
import { createTransaction } from "@/app/actions/transactions";
import type { TxnInput } from "@/lib/schemas/transaction";

export interface OutboxItem {
  client_id: string;
  created_at: number;
  /** pending: waiting for the server · failed: the server refused it (needs the user's attention). */
  status: "pending" | "failed";
  attempts: number;
  error?: string;
  /** The server accepted it at this time; hidden from views once a refetch is newer than this. */
  confirmed_at?: number;
  payload: TxnInput;
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

export async function enqueue(payload: TxnInput): Promise<OutboxItem> {
  const item: OutboxItem = { client_id: payload.client_id, created_at: Date.now(), status: "pending", attempts: 0, payload };
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

async function doFlush(): Promise<FlushResult> {
  const rows = (await db().outbox.where("status").equals("pending").sortBy("created_at")).filter((r) => !r.confirmed_at);
  let confirmed = 0;
  for (const row of rows) {
    let res;
    try {
      res = await createTransaction(row.payload);
    } catch {
      return { confirmed, blocked: true }; // offline: the request never reached the server
    }
    if (res.ok) {
      await db().outbox.update(row.client_id, { confirmed_at: Date.now() });
      confirmed += 1;
    } else if (res.retry) {
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
