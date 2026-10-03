import { describe, expect, it } from "vitest";
import { initialRate, observe, parseRate } from "./rate.js";

const MIN = 60_000;

describe("rate", () => {
  it("moves toward the observed rate between readings 40 min apart", () => {
    let m = observe(initialRate(), 40, 0, true);
    m = observe(m, 47, 40 * MIN, true); // 7 % in 40 min = 10.5 %/h
    expect(m.ratePctPerH).toBeCloseTo(0.7 * 10 + 0.3 * 10.5);
  });

  it("ignores readings 10 min apart", () => {
    let m = observe(initialRate(), 40, 0, true);
    m = observe(m, 42, 10 * MIN, true);
    expect(m.ratePctPerH).toBe(10);
    expect(m.anchor?.soc).toBe(40);
  });

  it("drops the anchor when not charging", () => {
    const m = observe(observe(initialRate(), 40, 0, true), 41, 60 * MIN, false);
    expect(m.anchor).toBeNull();
    expect(m.ratePctPerH).toBe(10);
  });

  it("survives odd stored values", () => {
    expect(parseRate("x").ratePctPerH).toBe(10);
    expect(parseRate({ ratePctPerH: -3 }).ratePctPerH).toBe(10);
    expect(parseRate({ ratePctPerH: 12, anchor: { soc: 3, atMs: 5 } })).toEqual({
      ratePctPerH: 12,
      anchor: { soc: 3, atMs: 5 },
    });
  });
});
