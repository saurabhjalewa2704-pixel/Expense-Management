// "A new version is ready" detection for the installed PWA. The service worker no longer takes over by itself
// (skipWaiting is off), so a new build installs, waits, and the app offers a Refresh. This file is the logic, free of React
// so it can be tested with plain fakes.

type Listener = () => void;
interface WatchedWorker { state: string; addEventListener(type: "statechange", cb: Listener): void }
interface WatchedRegistration {
  waiting: ServiceWorker | null;
  installing: WatchedWorker | null;
  addEventListener(type: "updatefound", cb: Listener): void;
}

/**
 * Calls `onWaiting` whenever a new worker is installed and waiting while an older one controls the page.
 * (On the very first install there is no controller: nothing is "old", so there is nothing to offer.)
 */
export function watchForUpdate(reg: WatchedRegistration, hasController: () => boolean, onWaiting: (w: ServiceWorker) => void): void {
  const check = () => { if (reg.waiting && hasController()) onWaiting(reg.waiting); };
  check();
  reg.addEventListener("updatefound", () => {
    const incoming = reg.installing;
    incoming?.addEventListener("statechange", () => { if (incoming.state === "installed") check(); });
  });
}

/** Ask the waiting worker to take over, then reload once it controls the page. Returns false if there is nothing to apply. */
export function applyUpdate(waiting: Pick<ServiceWorker, "postMessage"> | null, container: Pick<ServiceWorkerContainer, "addEventListener">, reload: () => void): boolean {
  if (!waiting) return false;
  let done = false;
  container.addEventListener("controllerchange", () => { if (!done) { done = true; reload(); } });
  waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

export interface ApplyOptions {
  /** How long to wait for the browser to report the switch before reloading anyway. */
  fallbackMs?: number;
  /** Runs before the reload (the app drops its stored pages so the reload brings the new version, not the old one from the device). */
  beforeReload?: () => Promise<unknown>;
}

/**
 * Switch to the newest version, whatever the banner last heard. The worker the banner holds can be out of date (a newer build may have
 * installed while the app was frozen in the background, which makes the one it holds "redundant" and deaf to the message), so the
 * waiting worker is looked up now, at the tap. The browser's "controllerchange" is the normal sign that the switch happened, but it can
 * be missed, so after a few seconds the app reloads anyway: it must never sit on "Updating…".
 */
export function applyLatestUpdate(
  reg: Pick<ServiceWorkerRegistration, "waiting"> | null | undefined,
  container: Pick<ServiceWorkerContainer, "addEventListener">,
  reload: () => void,
  opts: ApplyOptions = {},
): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    void (opts.beforeReload ? opts.beforeReload().catch(() => undefined) : Promise.resolve()).then(reload);
  };
  container.addEventListener("controllerchange", go);
  const waiting = reg?.waiting;
  if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
  setTimeout(go, waiting ? (opts.fallbackMs ?? 6000) : 0);          // nothing waiting: the new version is already active (or on its way), just reload
}
