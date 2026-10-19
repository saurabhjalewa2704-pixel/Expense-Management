/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// The app shell is precached and pages are cached as they are visited, so the installed app launches with no signal.
// Data is not cached here: TanStack Query persists it to IndexedDB (accounts, categories, recent transactions).
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: { entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }] },
});

// NOT-01 evening reminder. The payload is {title, body, url}; the server sends it only when nothing was logged today.
self.addEventListener("push", (event) => {
  const d = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  event.waitUntil(self.registration.showNotification(d.title ?? "Sterling", {
    body: d.body ?? "Anything to log from today?",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "evening-reminder",
    data: { url: d.url ?? "/?add=1" },
    actions: [{ action: "log", title: "Log now" }, { action: "nothing", title: "Nothing to log" }],
  } as NotificationOptions));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "nothing") {
    // a genuine zero-spend day: record the marker, no window needed
    event.waitUntil(fetch("/api/no-spend", { method: "POST", credentials: "same-origin" }).catch(() => undefined));
    return;
  }
  const url = new URL((event.notification.data as { url?: string } | undefined)?.url ?? "/?add=1", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (existing) { await existing.focus(); await existing.navigate(url).catch(() => undefined); }
    else await self.clients.openWindow(url);
  })());
});

serwist.addEventListeners();
