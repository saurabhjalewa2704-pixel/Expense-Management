/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import { Serwist, StaleWhileRevalidate, type PrecacheEntry, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// The app shell is precached and pages are cached as they are visited, so the installed app launches with no signal.
// Data is not cached here: TanStack Query persists it to IndexedDB (accounts, categories, recent transactions).

/** The cache the page HTML lives in. components/settings/settings-screen.tsx empties it on sign-out. */
const PAGES = "pages";

/** One entry per path: "/?add=1" from a notification opens the same shell as "/". */
const shellKey = (request: Request) => { const u = new URL(request.url); return new Request(`${u.origin}${u.pathname}`); };

/**
 * Open pages from the device first and refresh them behind the scenes (stale-while-revalidate).
 *
 * defaultCache fetches every page network-first with no timeout. The page is a thin client-rendered shell, but the request
 * still goes through the proxy (a Supabase auth round trip) and a serverless function, so on the first open of the day,
 * with the server cold, the phone showed a black screen for 5 to 6 seconds before the shell and the cached figures appeared.
 * The HTML carries no personal data, so there is nothing to wait for: show it now, let the network update it for next time.
 */
const appShell: SerwistPlugin = {
  cacheKeyWillBeUsed: async ({ request }) => shellKey(request),
  // only a real page is stored, never a redirect to /sign-in or an error page
  cacheWillUpdate: async ({ response }) => (response.status === 200 && !response.redirected ? response : null),
  // the proxy answered with a redirect: the session is gone, so forget the stored page and let the next open ask the server
  fetchDidSucceed: async ({ request, response }) => {
    if (response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400)) await (await caches.open(PAGES)).delete(shellKey(request));
    return response;
  },
};
const NOT_SHELL = /^\/(sign-in|api|serwist|offline)(\/|$)/;
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new build waits until the app offers it (components/shell/update-banner.tsx posts SKIP_WAITING), so the page the user
  // is looking at never changes underneath them.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ request, sameOrigin, url }) => sameOrigin && request.mode === "navigate" && !NOT_SHELL.test(url.pathname), handler: new StaleWhileRevalidate({ cacheName: PAGES, plugins: [appShell] }) },
    ...defaultCache,
  ],
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

// A new build brings new script names, so pages stored by the old one are dropped when the new worker takes over.
self.addEventListener("activate", (event) => { event.waitUntil(caches.delete(PAGES)); });

serwist.addEventListeners();
