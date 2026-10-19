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
