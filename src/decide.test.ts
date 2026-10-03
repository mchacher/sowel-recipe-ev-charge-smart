import { describe, expect, it } from "vitest";
import { decide, nextDeparture, type DecideInput } from "./decide.js";

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2026, 9, 3, h, m, 0, 0);
  return d;
};

const base = (o: Partial<DecideInput> = {}): DecideInput => ({
  vehicle: "connected",
  battery: 50,
  carCompleted: false,
  carLimit: null,
  targetSoc: 80,
  minSoc: 30,
  departure: "07:30",
  offPeakNow: null,
  ratePctPerH: 10,
  manualHold: false,
  refusedUntilUnplug: false,
  granted: false,
  now: at("13:00"),
  ...o,
});

describe("decide", () => {
  it("unplugged: release, leave the charger", () => {
    expect(decide(base({ vehicle: "disconnected" }))).toMatchObject({
      mode: "unplugged",
      claim: "release",
      charger: "leave",
    });
  });

  it("offline charger: no change, need withdrawn", () => {
    expect(decide(base({ vehicle: null }))).toMatchObject({
      mode: "offline",
      charger: "leave",
      claim: "keep",
      need: false,
    });
  });

  it("done at the target: stop and release", () => {
    expect(decide(base({ battery: 85 }))).toMatchObject({
      mode: "done",
      charger: "stop",
      claim: "release",
      need: false,
    });
  });

  it("honours the car's own lower limit", () => {
    const d = decide(base({ battery: 75, carLimit: 70 }));
    expect(d.mode).toBe("done");
    expect(d.effectiveTarget).toBe(70);
  });

  it("done when the car refused twice this plug-in", () => {
    expect(decide(base({ refusedUntilUnplug: true }))).toMatchObject({
      mode: "done",
      claim: "release",
    });
  });

  it("done when the car says completed", () => {
    expect(decide(base({ battery: 60, carCompleted: true })).mode).toBe("done");
  });

  it("guarantee during off-peak hours below the minimum", () => {
    expect(decide(base({ battery: 20, offPeakNow: true, now: at("23:00") }))).toMatchObject({
      mode: "guarantee",
      charger: "run",
      claim: "keep",
      need: true,
    });
  });

  it("no tariff: waits for the latest start, then guarantees", () => {
    // 10 % to gain at 10 %/h = 1 h, + 30 min margin → 06:00 for a 07:30 departure.
    const early = decide(base({ battery: 20, now: at("02:00") }));
    expect(early.mode).toBe("surplus");
    expect(early.latestStart?.getHours()).toBe(6);
    expect(early.latestStart?.getMinutes()).toBe(0);
    expect(decide(base({ battery: 20, now: at("06:05") })).mode).toBe("guarantee");
  });

  it("after departure, aims at the next day's", () => {
    const d = decide(base({ battery: 20, now: at("08:00") }));
    expect(d.mode).toBe("surplus");
    expect(d.latestStart?.getDate()).toBe(4);
  });

  it("unknown battery: surplus only, never guarantee", () => {
    expect(decide(base({ battery: null, offPeakNow: true })).mode).toBe("surplus");
  });

  it("manual hold leaves the charger alone", () => {
    expect(decide(base({ manualHold: true }))).toMatchObject({
      mode: "manual",
      charger: "leave",
      need: false,
    });
  });

  it("min_soc 0 never guarantees", () => {
    expect(decide(base({ battery: 5, minSoc: 0, offPeakNow: true })).mode).toBe("surplus");
  });

  it("surplus runs only when granted", () => {
    expect(decide(base({ granted: true })).charger).toBe("run");
    expect(decide(base({ granted: false })).charger).toBe("stop");
  });
});

describe("nextDeparture", () => {
  it("today when still ahead, else tomorrow", () => {
    expect(nextDeparture("07:30", at("06:00")).getDate()).toBe(3);
    expect(nextDeparture("07:30", at("07:30")).getDate()).toBe(4);
  });
});
