import { describe, expect, it } from "vitest";
import { activeCar, readCar, readCharger, type CarView } from "./inputs.js";
import { FakeWorld } from "./testing/ctx.testing.js";

const car = (id: string, o: Partial<CarView> = {}): CarView => ({
  id,
  name: id,
  battery: 50,
  plugged: true,
  atHome: true,
  chargingState: "idle",
  chargeLimit: null,
  hasWake: true,
  hasRefresh: true,
  ...o,
});

describe("activeCar (FR1)", () => {
  it("one of two cars plugged", () => {
    const r = activeCar([car("rafale"), car("megane", { plugged: false })], "connected");
    expect(r).toMatchObject({ reason: "single" });
    expect(r.car?.id).toBe("rafale");
  });

  it("both plugged, one charging", () => {
    const r = activeCar([car("rafale"), car("megane", { chargingState: "charging" })], "charging");
    expect(r.car?.id).toBe("megane");
    expect(r.candidates).toHaveLength(2);
  });

  it("both plugged and idle: ambiguous, both candidates", () => {
    const r = activeCar([car("rafale"), car("megane")], "connected");
    expect(r).toMatchObject({ car: null, reason: "ambiguous" });
    expect(r.candidates).toHaveLength(2);
  });

  it("none reported plugged, one configured: that one", () => {
    expect(activeCar([car("rafale", { plugged: false })], "connected").car?.id).toBe("rafale");
  });

  it("none plugged, two configured: unknown", () => {
    expect(
      activeCar([car("a", { plugged: false }), car("b", { plugged: false })], "connected").reason,
    ).toBe("none");
  });

  it("a car away from home is not a candidate", () => {
    expect(activeCar([car("rafale", { atHome: false })], "connected").car).toBeNull();
  });
});

describe("reading equipments by contract alias", () => {
  it("reads the charger and the car", () => {
    const w = new FakeWorld()
      .charger({ state: "ON", vehicle: "charging" })
      .car("rafale", { battery_level: "8" });
    const ctx = w.ctx();
    expect(readCharger(ctx, "charger")).toMatchObject({
      state: true,
      vehicle: "charging",
      voltage: 230,
    });
    expect(readCar(ctx, "rafale")).toMatchObject({
      battery: 8,
      plugged: true,
      hasWake: true,
      hasRefresh: true,
    });
  });

  it("an unknown vehicle state reads as null", () => {
    const w = new FakeWorld().charger({ vehicle: "weird" });
    expect(readCharger(w.ctx(), "charger").vehicle).toBeNull();
  });
});

describe("charge_current order bounds (spec 002)", () => {
  it("reads min and max from the charger's order binding", () => {
    const w = new FakeWorld().charger();
    w.currentBounds = { min: 6, max: 13 };
    expect(readCharger(w.ctx(), "charger")).toMatchObject({ currentMin: 6, currentMax: 13 });
    w.currentBounds = {};
    expect(readCharger(w.ctx(), "charger")).toMatchObject({ currentMin: null, currentMax: null });
  });
});
