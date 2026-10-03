import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChargerControl, type StartRequest } from "./charger.js";
import type { CarView } from "./inputs.js";
import { FakeWorld } from "./testing/ctx.testing.js";

const car = (id: string, o: Partial<CarView> = {}): CarView => ({
  id,
  name: id,
  battery: 50,
  plugged: true,
  atHome: true,
  chargingState: "waiting",
  chargeLimit: null,
  hasWake: true,
  hasRefresh: true,
  ...o,
});

function setup() {
  const w = new FakeWorld().charger().car("rafale");
  const ctx = w.ctx();
  const alerts: (string | null)[] = [];
  const control = new ChargerControl({
    chargerId: "charger",
    dispatch: ctx.dispatchOrder,
    log: (m, l) => ctx.log(m, l),
    alert: (m) => alerts.push(m),
    now: () => Date.now(),
    later: (ms, fn) => void setTimeout(fn, ms),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const req = (o: Partial<StartRequest> = {}): StartRequest => ({
    current: 10,
    currentNow: 10,
    wakeCars: [car("rafale")],
    refreshCar: car("rafale"),
    alertOnGiveUp: true,
    ...o,
  });
  return { w, control, alerts, req };
}

describe("ChargerControl", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sets the current first when it differs, then switches on", async () => {
    const { w, control, req } = setup();
    await control.start(req({ currentNow: 16 }));
    expect(w.orders.map((o) => o.alias)).toEqual(["charge_current", "state"]);
    expect(w.orders[0].value).toBe(10);
    expect(control.owned).toBe(true);
  });

  it("skips the current order when already right", async () => {
    const { w, control, req } = setup();
    await control.start(req());
    expect(w.orders.map((o) => o.alias)).toEqual(["state"]);
  });

  it("refreshes the car 60 s after a start", async () => {
    const { w, control, req } = setup();
    await control.start(req());
    expect(w.ordersTo("refresh")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.ordersTo("refresh", "rafale")).toHaveLength(1);
  });

  it("no refresh when the car does not offer it", async () => {
    const { w, control, req } = setup();
    await control.start(req({ refreshCar: car("rafale", { hasRefresh: false }) }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.ordersTo("refresh")).toHaveLength(0);
  });

  it("wakes a sleeping car and retries after 30 s", async () => {
    const { w, control, req } = setup();
    let awake = false;
    w.answer = (c) => {
      if (c.alias === "wake") {
        awake = true;
        return { success: true };
      }
      if (c.alias === "state" && c.value === true && !awake)
        return {
          success: false,
          error: "Order charge not reflected: the vehicle is not asking for current",
        };
      return undefined;
    };
    const p = control.start(req());
    await vi.advanceTimersByTimeAsync(29_000);
    expect(w.ordersTo("state")).toHaveLength(1);
    expect(w.ordersTo("wake", "rafale")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBe(true);
    expect(w.ordersTo("state")).toHaveLength(2);
    expect(control.owned).toBe(true);
  });

  it("a failed start (two wakes) backs off 15 min; a second gives up until unplug", async () => {
    const { w, control, alerts, req } = setup();
    w.answer = (c) =>
      c.alias === "state" ? { success: false, error: "not asking for current" } : undefined;
    let p = control.start(req());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toBe(false);
    expect(w.ordersTo("wake")).toHaveLength(2);
    expect(w.ordersTo("state")).toHaveLength(3);
    expect(control.inBackoff()).toBe(true);
    expect(alerts).toHaveLength(0);
    expect(await control.start(req())).toBe(false);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    p = control.start(req());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toBe(false);
    expect(control.gaveUp).toBe(true);
    expect(alerts.at(-1)).toMatch(/ne demande plus/);
    control.resetSession();
    expect(control.gaveUp).toBe(false);
  });

  it("an unavailable integration (throw) is not followed by a wake", async () => {
    const { w, control, req } = setup();
    w.answer = (c) => (c.alias === "state" ? "throw" : undefined);
    expect(await control.start(req())).toBe(false);
    expect(w.ordersTo("wake")).toHaveLength(0);
    expect(control.inBackoff()).toBe(false);
  });

  it("stops only a charge it owns", async () => {
    const { w, control, req } = setup();
    await control.stop("x");
    expect(w.orders).toHaveLength(0);
    await control.start(req());
    await control.stop("x");
    expect(w.ordersTo("state").map((o) => o.value)).toEqual([true, false]);
    expect(control.owned).toBe(false);
  });
});
