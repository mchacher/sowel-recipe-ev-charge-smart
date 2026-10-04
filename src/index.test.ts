import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipe, readParams } from "./index.js";
import { FakeWorld } from "./testing/ctx.testing.js";

const PARAMS = {
  zone: "garage",
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

  it("declares a zone slot first, so the instance shows in its zone's Behaviours", () => {
    const zone = createRecipe().slots[0];
    expect(zone).toMatchObject({ id: "zone", type: "zone", required: true });
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

  it("a person switching the charger OFF hands it back at once (spec 003)", async () => {
    const w = new FakeWorld().charger().car("rafale", { battery_level: 20 });
    w.offPeakNow = true; // the guarantee wants to charge
    const h = start(w);
    await settle();
    w.userOrder(true); // a person runs a charge by hand
    await settle();
    expect(w.state.get("mode")).toBe("manual");
    const before = w.ordersTo("state").length;
    w.userOrder(false); // …and stops it
    await settle(200_000); // past the 2-min window of the recipe's own earlier start
    expect(w.state.get("hold")).toBe(false);
    expect(w.state.get("mode")).toBe("guarantee");
    expect(w.ordersTo("state").length).toBeGreaterThan(before); // the recipe restarted the charge
    expect(w.logs.some((l) => /reprend la main/.test(l.message))).toBe(true);
    h.stop();
  });

  it("the arbiter's manual-override revoke for a person's OFF does not hold (spec 003)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    // The real core: the arbiter handles the order first and revokes, then
    // the recipe sees the order itself.
    w.revoke("manual-override");
    w.userOrder(false);
    await settle();
    expect(w.state.get("hold")).not.toBe(true);
    expect(w.state.get("mode")).not.toBe("manual");
    // Never even briefly held: no "switched on by hand" line for an OFF.
    expect(w.logs.some((l) => /allumée à la main/.test(l.message))).toBe(false);
    h.stop();
  });

  it("a person's ON on a charge the recipe owns: held, and the charge is not stopped", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    expect(states(w)).toEqual([true]);
    // The real core order: the arbiter revokes, then the recipe sees the order.
    w.revoke("manual-override");
    w.userOrder(true);
    await settle(60_000);
    expect(w.state.get("mode")).toBe("manual");
    expect(states(w)).toEqual([true]); // no OFF sent behind the person
    h.stop();
  });

  it("a hold survives a restart while the car stays plugged, and is dropped once unplugged (spec 003)", async () => {
    const w = new FakeWorld().charger({ state: false, vehicle: "connected" }).car("rafale");
    w.state.set("hold", true); // a charge switched on by hand, car now paused
    let h = start(w);
    await settle();
    expect(w.state.get("mode")).toBe("manual");
    h.stop();
    const w2 = new FakeWorld().charger({ state: false, vehicle: "disconnected" }).car("rafale");
    w2.state.set("hold", true);
    h = start(w2);
    await settle();
    expect(w2.state.get("hold")).toBe(false);
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
    // The revoke alone never stops the charge it answers (review).
    expect(states(w)).toEqual([true]);
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

  it("claims with the charger's range and keeps watts for older cores (spec 002 FR1)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w, { ...PARAMS, max_current: 16 });
    await settle();
    expect(w.lastClaim()).toMatchObject({
      watts: 2300,
      modulation: { minW: 1380, maxW: 3680, stepW: 230 },
    });
    h.stop();
  });

  it("a surplus start uses the budget current; budget changes follow while charging (AC2, AC3)", async () => {
    const w = new FakeWorld().charger({ charge_current: 10 }).car("rafale");
    const h = start(w, { ...PARAMS, max_current: 16 });
    await settle();
    w.grant();
    w.budget(2990);
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([13]);
    expect(w.equipments.get("charger")!.data.state).toBe(true);
    w.budget(3680);
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([13, 16]);
    w.budget(1400);
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([13, 16, 6]);
    expect(w.logs.filter((l) => /courant/i.test(l.message))).toHaveLength(0); // no log line per change
    h.stop();
  });

  it("the guarantee keeps its fixed current whatever the budget (FR4)", async () => {
    const w = new FakeWorld().charger({ charge_current: 16 }).car("rafale", { battery_level: 20 });
    w.offPeakNow = true;
    const h = start(w, { ...PARAMS, charge_current: 10, max_current: 16 });
    await settle();
    expect(w.state.get("mode")).toBe("guarantee");
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([10]);
    w.grant();
    w.budget(3680);
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([10]);
    h.stop();
  });

  it("a surplus charge turning into a guarantee moves to the fixed current", async () => {
    const w = new FakeWorld().charger({ charge_current: 10 }).car("rafale", { battery_level: 20 });
    const h = start(w, { ...PARAMS, charge_current: 10, max_current: 16 });
    await settle();
    w.grant();
    w.budget(1380);
    await settle();
    expect(w.equipments.get("charger")!.data.charge_current).toBe(6);
    w.offPeakNow = true; // off-peak begins: the guarantee takes over
    await settle(60_000);
    expect(w.state.get("mode")).toBe("guarantee");
    expect(w.equipments.get("charger")!.data.charge_current).toBe(10);
    h.stop();
  });

  it("sends a current once per value while the charger has not confirmed it", async () => {
    const w = new FakeWorld().charger({ charge_current: 10 }).car("rafale");
    const h = start(w, { ...PARAMS, max_current: 16 });
    await settle();
    w.grant();
    w.budget(2990);
    await settle();
    w.reflectCurrent = false;
    w.budget(3680);
    for (let i = 0; i < 10; i++) w.set("charger", "power", 3000 + i); // readings
    await settle(5 * 60_000);
    expect(w.ordersTo("charge_current").filter((o) => o.value === 16)).toHaveLength(1);
    h.stop();
  });

  it("a current order does not delay a restart (quiet window is for starts)", async () => {
    const w = new FakeWorld().charger({ charge_current: 10 }).car("rafale");
    const h = start(w, { ...PARAMS, max_current: 16 });
    await settle();
    w.grant();
    w.budget(2990);
    await settle(150_000); // past the start's quiet window
    w.budget(3680); // a current order now
    await settle();
    w.carStops();
    await settle(61_000); // next tick, well inside 120 s of the current order
    expect(w.ordersTo("state").map((o) => o.value)).toEqual([true, true]);
    h.stop();
  });

  it("learns the charge rate only at the guarantee's current", async () => {
    const w = new FakeWorld().charger({ charge_current: 10 }).car("rafale", { battery_level: 40 });
    const h = start(w, { ...PARAMS, charge_current: 10, max_current: 16 });
    await settle();
    w.grant();
    w.budget(3680); // surplus at 16 A
    await settle();
    w.set("rafale", "battery_level", 41);
    await settle(40 * 60_000);
    w.set("rafale", "battery_level", 50);
    await settle();
    expect(w.state.get("rate.rafale")).toMatchObject({ ratePctPerH: 10, anchor: null });
    h.stop();
  });

  it("max_current below the minimum: binary claim, spec 001 behaviour", async () => {
    const w = new FakeWorld().charger({ charge_current: 16 }).car("rafale");
    const h = start(w, { ...PARAMS, charge_current: 10, max_current: 4 });
    await settle();
    expect(w.lastClaim()!.modulation).toBeUndefined();
    w.grant();
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([10]);
    h.stop();
  });

  it("an older core (no budgetW) gets spec 001's behaviour (AC4)", async () => {
    const w = new FakeWorld().charger({ charge_current: 16 }).car("rafale");
    w.core185 = false;
    const h = start(w, { ...PARAMS, charge_current: 10, max_current: 16 });
    await settle();
    w.grant();
    await settle();
    expect(w.ordersTo("charge_current").map((o) => o.value)).toEqual([10]);
    h.stop();
  });

  it("the tile shows the current in surplus mode (FR6)", async () => {
    const w = new FakeWorld().charger().car("rafale");
    const h = start(w);
    await settle();
    w.grant();
    await settle();
    w.budget(2990);
    await settle();
    expect(w.state.get("summary")).toMatch(/☀ Surplus · 50 % → 80 % · 13 A/);
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
