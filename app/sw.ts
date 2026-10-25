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
  // A new build waits until the app offers it (components/shell/update-banner.tsx posts SKIP_WAITING), so the page the user
  // is looking at never changes underneath them.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: { entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }] },
});

// NOT-01 evening reminder. The payload is {title, body, url}; the server sends it only when nothing was logged today.
self.addEventListener("push", (event) => {
  const d = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string; tag?: string; actions?: { action: string; title: string }[]; data?: Record<string, unknown> };
  const bill = !!d.tag;            // REC-05 bill notifications carry their own tag, actions and data
  event.waitUntil(self.registration.showNotification(d.title ?? "Sterling", {
    body: d.body ?? "Anything to log from today?",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag ?? "evening-reminder",
    data: { url: d.url ?? "/?add=1", bill, ...d.data },
    actions: d.actions ?? (bill ? [] : [{ action: "log", title: "Log now" }, { action: "nothing", title: "Nothing to log" }]),
  } as NotificationOptions));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const n = event.notification.data as { bill?: boolean; occurrence?: string } | undefined;
  if (n?.bill && n.occurrence && (event.action === "confirm" || event.action === "log" || event.action === "skip")) {
    // REC-05: "Looks right", "Log it" and "Skip" are answered without opening the app
    event.waitUntil(fetch("/api/recurring/action", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ occurrence: n.occurrence, action: event.action }),
    }).catch(() => undefined));
    return;
  }
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
