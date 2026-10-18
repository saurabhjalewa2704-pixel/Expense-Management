"use client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, type Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { useState } from "react";

const KEY = "sterling-query-cache";
const BUSTER = "v1";
const DAY = 24 * 60 * 60 * 1000;

/** Persist the query cache to IndexedDB (throttled), so repeat launches render instantly and offline. */
function createPersister(): Persister {
  if (typeof indexedDB === "undefined") {
    return { persistClient: async () => {}, restoreClient: async () => undefined, removeClient: async () => {} };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: Parameters<Persister["persistClient"]>[0] | undefined;
  return {
    persistClient: (client) => {
      latest = client;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (latest) void set(KEY, latest).catch(() => {});
      }, 1000);
    },
    restoreClient: () => get(KEY).catch(() => undefined),
    removeClient: () => del(KEY).catch(() => {}),
  };
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Never garbage-collect in memory: the persisted cache is what ages out (maxAge below). A finite 30-day
        // value overflows setTimeout's 32-bit limit (it becomes 1 ms), which would evict every query at once.
        gcTime: Infinity,
        networkMode: "offlineFirst", // show cached data, retry when the network returns
        refetchOnWindowFocus: false, // the sync layer decides when to refetch (flush the outbox first)
        retry: 1,
      },
      mutations: { networkMode: "offlineFirst" },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [persister] = useState(createPersister);
  return (
    <PersistQueryClientProvider
      client={client}
      // Show the cached data instantly, then revalidate it all: a restored cache carries a fresh timestamp, so without this
      // a change made just before closing the app (inside the persist throttle) could stay hidden for a minute.
      onSuccess={() => { void client.invalidateQueries(); }}
      persistOptions={{
        persister,
        maxAge: 30 * DAY,
        buster: BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && q.meta?.persist !== false },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
