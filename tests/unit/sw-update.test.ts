import { describe, expect, it, vi } from "vitest";
import { applyLatestUpdate, applyUpdate, watchForUpdate } from "@/lib/sw-update";

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

describe("applyLatestUpdate (never stuck on 'Updating…')", () => {
  const container = () => { const c = emitter(); return { c, api: { addEventListener: (_t: "controllerchange", cb: L) => c.on("controllerchange", cb) } as never }; };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("asks the worker that is waiting now, and reloads once when the browser reports the switch", async () => {
    const w = sw(), reload = vi.fn(), { c, api } = container();
    applyLatestUpdate({ waiting: w }, api, reload);
    expect((w as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    c.fire("controllerchange"); c.fire("controllerchange");
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads anyway when the switch is never reported (a stale or deaf worker)", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(), { api } = container();
    applyLatestUpdate({ waiting: sw() }, api, reload, { fallbackMs: 6000 });
    await vi.advanceTimersByTimeAsync(5999);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("with nothing waiting (it is already active) it just reloads", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(), { api } = container();
    applyLatestUpdate({ waiting: null }, api, reload);
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("drops the stored pages before it reloads, and reloads even if that fails", async () => {
    vi.useFakeTimers();
    const order: string[] = [], { api } = container();
    applyLatestUpdate({ waiting: null }, api, () => order.push("reload"), { beforeReload: async () => { order.push("clear"); throw new Error("no cache storage"); } });
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["clear", "reload"]);
    vi.useRealTimers();
  });
});
