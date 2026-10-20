import { describe, expect, it, vi } from "vitest";
import { applyUpdate, watchForUpdate } from "@/lib/sw-update";

type L = () => void;
const emitter = () => { const m = new Map<string, L[]>(); return { on: (t: string, cb: L) => m.set(t, [...(m.get(t) ?? []), cb]), fire: (t: string) => (m.get(t) ?? []).forEach((cb) => cb()) }; };
const sw = () => ({ postMessage: vi.fn() }) as unknown as ServiceWorker;

describe("watchForUpdate", () => {
  it("offers an update that is already waiting when the app opens", () => {
    const waiting = sw(), seen: ServiceWorker[] = [];
    watchForUpdate({ waiting, installing: null, addEventListener: () => {} }, () => true, (w) => seen.push(w));
    expect(seen).toEqual([waiting]);
  });

  it("offers a new version once it finishes installing, not before", () => {
    const reg = emitter(), worker = emitter(); const w = sw();
    const r = { waiting: null as ServiceWorker | null, installing: { state: "installing", addEventListener: (_t: "statechange", cb: L) => worker.on("statechange", cb) }, addEventListener: (_t: "updatefound", cb: L) => reg.on("updatefound", cb) };
    const seen: ServiceWorker[] = [];
    watchForUpdate(r, () => true, (x) => seen.push(x));
    reg.fire("updatefound");
    worker.fire("statechange");
    expect(seen).toHaveLength(0);                       // still "installing"
    r.installing.state = "installed"; r.waiting = w;
    worker.fire("statechange");
    expect(seen).toEqual([w]);
  });

  it("does not nag on the very first install (nothing is controlling the page yet)", () => {
    const seen: ServiceWorker[] = [];
    watchForUpdate({ waiting: sw(), installing: null, addEventListener: () => {} }, () => false, (w) => seen.push(w));
    expect(seen).toHaveLength(0);
  });
});

describe("applyUpdate", () => {
  it("tells the waiting worker to take over and reloads exactly once when control changes", () => {
    const w = sw(), c = emitter(), reload = vi.fn();
    expect(applyUpdate(w, { addEventListener: (_t: "controllerchange", cb: L) => c.on("controllerchange", cb) } as never, reload)).toBe(true);
    expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();
    c.fire("controllerchange"); c.fire("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("does nothing without a waiting worker", () => {
    expect(applyUpdate(null, { addEventListener: vi.fn() } as never, vi.fn())).toBe(false);
  });
});
