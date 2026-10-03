import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipe, readParams } from "./index.js";
import { FakeWorld } from "./testing/ctx.testing.js";

const PARAMS = {
  charger: "charger",
  vehicles: ["rafale"],
  target_soc: 80,
  min_soc: 30,
  departure: "07:30",
  charge_current: 10,
};

function start(w: FakeWorld, params: Record<string, unknown> = PARAMS) {
  const ctx = w.ctx();
  const recipe = createRecipe();
  recipe.validate(params, ctx);
  return recipe.createInstance(params, ctx);
}

const settle = (ms = 1_000) => vi.advanceTimersByTimeAsync(ms);
const states = (w: FakeWorld) => w.ordersTo("state").map((o) => o.value);

describe("ev-charge-smart instance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 13, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("validates equipment types and the minimum", () => {
    const w = new FakeWorld().charger().car("rafale");
    const r = createRecipe();
    expect(() => r.validate({ ...PARAMS, charger: "rafale" }, w.ctx())).toThrow("EV charger");
    expect(() => r.validate({ ...PARAMS, min_soc: 90 }, w.ctx())).toThrow("minimum");
    expect(() => r.validate(PARAMS, w.ctx())).not.toThrow();
  });

  it("reads params defensively", () => {
    expect(
      readParams({ charger: "c", vehicles: "v", target_soc: "70", departure: "bad" }),
    ).toMatchObject({
      vehicleIds: ["v"],
      targetSoc: 70,
      departure: "07:30",
    });
  });

  it("claims the charger at current × voltage and reports the need", async () => {
    const w = new FakeWorld().charger({ voltage: 226 }).car("rafale");
    const h = start(w);
    await settle();
    expect(w.lastClaim()).toMatchObject({ equipmentId: "charger", watts: 2260 });
    expect(w.lastClaim()!.need.at(-1)).toBe(true);
    h.stop();
  });

  it("granted → starts; revoked → stops (AC1)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    expect(states(w)).toEqual([true]);
    expect(w.state.get("summary")).toMatch(/☀ Surplus/);
    w.revoke();
    await settle();
    expect(states(w)).toEqual([true, false]);
    h.stop();
  });

  it("a synchronous grant at claim time is acted on in the same evaluation", async () => {
    const w = new FakeWorld().charger().car("rafale");
    w.grantOnClaim = true;
    const h = start(w);
    await settle();
    expect(states(w)).toEqual([true]);
    h.stop();
  });

  it("a revoke during a start (wake in progress) stops the charge once it starts", async () => {
    const w = new FakeWorld().charger().car("rafale");
    w.car_ = "asleep";
    const h = start(w);
    await settle();
    w.grant();
    await settle(); // refused, wake sent, waiting 30 s
    w.revoke();
    await settle(40_000);
    expect(states(w)).toEqual([true, true, false]);
    h.stop();
  });

  it("wakes a sleeping car and the charge starts (AC4), refresh 60 s later (AC5)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    w.car_ = "asleep";
    const h = start(w);
    await settle();
    w.grant();
    await settle(31_000);
    expect(w.ordersTo("wake", "rafale")).toHaveLength(1);
    expect(states(w)).toEqual([true, true]);
    expect(w.equipments.get("charger")!.data.vehicle).toBe("charging");
    await settle(60_000);
    expect(w.ordersTo("refresh", "rafale")).toHaveLength(1);
    h.stop();
  });

  it("a full car is not woken all afternoon: two failed starts, then done until unplug", async () => {
    const w = new FakeWorld().charger().car("rafale", { battery_level: 60 });
    w.car_ = "full";
    const h = start(w);
    await settle();
    w.grant();
    await settle(2 * 3_600_000);
    expect(w.ordersTo("wake")).toHaveLength(4); // 2 starts × 2 wakes
    expect(w.state.get("mode")).toBe("done");
    expect(w.state.get("alert")).toBeUndefined(); // the minimum is not at risk
    expect(w.lastClaim()!.handle.status()).toBe("released");
    // A new plug-in starts over.
    w.set("charger", "vehicle", "disconnected");
    await settle();
    w.car_ = "awake";
    w.set("charger", "vehicle", "connected");
    await settle();
    w.grant();
    await settle();
    expect(w.equipments.get("charger")!.data.state).toBe(true);
    h.stop();
  });

  it("the car stopping by itself is not a manual hold; the charge resumes after a wake", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    w.car_ = "asleep";
    w.carStops();
    // Restart after the 2-min draw window (next tick), wake, 30 s, retry.
    await settle(5 * 60_000);
    expect(w.state.get("mode")).toBe("surplus");
    expect(w.state.get("hold")).not.toBe(true);
    expect(w.ordersTo("wake")).toHaveLength(1);
    expect(w.equipments.get("charger")!.data.state).toBe(true);
    h.stop();
  });

  it("revoke during the guarantee does not stop the charge", async () => {
    const w = new FakeWorld().charger().car("rafale", { battery_level: 20 });
    w.offPeakNow = true;
    const h = start(w);
    await settle();
    expect(states(w)).toEqual([true]);
    expect(w.state.get("mode")).toBe("guarantee");
    w.grant();
    w.revoke();
    await settle();
    expect(states(w)).toEqual([true]);
    h.stop();
  });

  it("stops and releases at the target (AC2)", async () => {
    const w = new FakeWorld().charger().car("rafale", { battery_level: 78 });
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    w.set("rafale", "battery_level", 80);
    await settle();
    expect(states(w)).toEqual([true, false]);
    expect(w.lastClaim()!.handle.status()).toBe("released");
    expect(w.state.get("mode")).toBe("done");
    h.stop();
  });

  it("a person switching the charger puts the recipe on hold until unplug (AC7)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.userOrder(true);
    await settle();
    w.grant();
    await settle();
    expect(w.ordersTo("state")).toHaveLength(0);
    expect(w.state.get("mode")).toBe("manual");
    w.set("charger", "vehicle", "disconnected");
    await settle();
    expect(w.state.get("mode")).toBe("unplugged");
    expect(w.state.get("hold")).toBe(false);
    h.stop();
  });

  it("a manual-override revoke also holds", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    w.revoke("manual-override");
    await settle();
    expect(w.state.get("mode")).toBe("manual");
    h.stop();
  });

  it("not profiled: logged once, asked again every 15 min only, the guarantee still runs", async () => {
    const w = new FakeWorld().charger().car("rafale", { battery_level: 20 });
    w.arbiter = "not-profiled";
    w.offPeakNow = true;
    const h = start(w);
    await settle();
    for (let i = 0; i < 20; i++) w.set("charger", "power", 2000 + i); // readings every few seconds
    await settle(20 * 60_000);
    expect(w.claims.length).toBeLessThanOrEqual(3);
    expect(w.logs.filter((l) => /profil énergie/.test(l.message))).toHaveLength(1);
    expect(states(w)).toEqual([true]);
    h.stop();
  });

  it("an offline charger is not an unplugged one: the hold survives", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.userOrder(true);
    await settle();
    w.set("charger", "vehicle", null);
    await settle();
    expect(w.state.get("mode")).toBe("offline");
    expect(w.state.get("hold")).toBe(true);
    w.set("charger", "vehicle", "charging");
    await settle();
    expect(w.state.get("mode")).toBe("manual");
    h.stop();
  });

  it("no need reported while backing off after a failed start", async () => {
    const w = new FakeWorld().charger().car("rafale");
    w.car_ = "full";
    const h = start(w);
    await settle();
    w.grant();
    await settle(70_000); // first start sequence failed, back-off
    expect(w.lastClaim()!.need.at(-1)).toBe(false);
    h.stop();
  });

  it("departure reached below the minimum: one alert, kept across a restart", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 7, 28, 0));
    const w = new FakeWorld().charger().car("rafale", { battery_level: 20 });
    w.car_ = "full";
    let h = start(w);
    await settle(4 * 60_000);
    expect(w.state.get("alert")).toMatch(/sous le minimum/);
    h.stop();
    h = start(w);
    await settle(60_000);
    expect(w.logs.filter((l) => /sous le minimum/.test(l.message))).toHaveLength(1);
    h.stop();
  });

  it("restart with ownership keeps it; without, a running charge is manual", async () => {
    const w = new FakeWorld().charger({ state: true, vehicle: "charging" }).car("rafale");
    w.state.set("owned", true);
    w.grantOnClaim = true;
    let h = start(w);
    await settle();
    expect(w.state.get("mode")).toBe("surplus");
    expect(w.ordersTo("state")).toHaveLength(0); // granted at once: kept running, no stop/start cycle
    h.stop();
    const w2 = new FakeWorld().charger({ state: true, vehicle: "charging" }).car("rafale");
    h = start(w2);
    await settle();
    expect(w2.state.get("mode")).toBe("manual");
    expect(w2.orders).toHaveLength(0);
    h.stop();
  });

  it("unplugging an owned charge switches the charger off (FR4)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    w.set("charger", "vehicle", "disconnected");
    await settle();
    expect(states(w)).toEqual([true, false]);
    h.stop();
  });

  it("two cars, one plugged: that one is woken and refreshed (AC6)", async () => {
    const w = new FakeWorld()
      .charger()
      .car("rafale", { plugged: false, charging_state: "unplugged" })
      .car("megane");
    w.car_ = "asleep";
    const h = start(w, { ...PARAMS, vehicles: ["rafale", "megane"] });
    await settle();
    w.grant();
    await settle(31_000);
    expect(w.ordersTo("wake").map((o) => o.equipmentId)).toEqual(["megane"]);
    expect(w.state.get("active_vehicle")).toBe("megane");
    h.stop();
  });

  it("logs one line per decision change, none per tick", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle(30 * 60_000);
    expect(w.logs).toHaveLength(1);
    h.stop();
  });

  it("stop clears timers, handlers and the claim", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    h.stop();
    expect(w.lastClaim()!.handle.status()).toBe("released");
    const before = w.orders.length;
    w.userOrder(true);
    await settle(10 * 60_000);
    expect(w.orders.length).toBe(before);
  });
});
