import { describe, expect, it } from "vitest";
import { ampsFor, rangeOf } from "./current.js";

const charger = (
  o: Partial<{ voltage: number | null; currentMin: number | null; currentMax: number | null }> = {},
) => ({
  voltage: 230,
  currentMin: 6,
  currentMax: 16,
  ...o,
});

describe("rangeOf (spec 002 FR1)", () => {
  it("uses the order bounds, capped by max_current", () => {
    expect(rangeOf(charger(), 32)).toMatchObject({
      minA: 6,
      maxA: 16,
      modulation: { minW: 1380, maxW: 3680, stepW: 230 },
    });
    expect(rangeOf(charger(), 10)).toMatchObject({ minA: 6, maxA: 10, modulation: { maxW: 2300 } });
  });

  it("defaults to 6–16 A at 230 V without bounds or voltage", () => {
    expect(
      rangeOf(charger({ voltage: null, currentMin: null, currentMax: null }), 32),
    ).toMatchObject({
      minA: 6,
      maxA: 16,
      volts: 230,
    });
  });

  it("uses the measured voltage", () => {
    expect(rangeOf(charger({ voltage: 226.4 }), 16).modulation).toEqual({
      minW: 1356,
      maxW: 3616,
      stepW: 226,
    });
  });

  it("no modulation when max_current is below the minimum (binary fallback)", () => {
    expect(rangeOf(charger(), 4).modulation).toBeNull();
  });
});

describe("ampsFor (spec 002 FR2, AC1)", () => {
  const r = rangeOf(charger(), 16);
  it("floors the budget onto whole amps within the range", () => {
    expect(ampsFor(2990, r)).toBe(13);
    expect(ampsFor(1380, r)).toBe(6);
    expect(ampsFor(5000, r)).toBe(16);
    expect(ampsFor(Number.NaN, r)).toBe(6);
  });
});
