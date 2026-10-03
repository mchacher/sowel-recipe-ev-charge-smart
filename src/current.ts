/**
 * Spec 002 — the charger's current range and the budget → amps mapping.
 * Pure: the instance stores the range it claimed with.
 */

export const NOMINAL_VOLTAGE = 230;
const DEFAULT_MIN_A = 6;
const DEFAULT_MAX_A = 16;

export interface CurrentRange {
  minA: number;
  maxA: number;
  volts: number;
  /** For the claim (core spec 185); null when the range is unusable. */
  modulation: { minW: number; maxW: number; stepW: number } | null;
}

export function rangeOf(
  charger: { voltage: number | null; currentMin: number | null; currentMax: number | null },
  maxCurrentParam: number,
): CurrentRange {
  const volts =
    charger.voltage !== null && charger.voltage > 100
      ? Math.round(charger.voltage)
      : NOMINAL_VOLTAGE;
  const minA = Math.ceil(charger.currentMin ?? DEFAULT_MIN_A);
  const maxA = Math.floor(Math.min(charger.currentMax ?? DEFAULT_MAX_A, maxCurrentParam));
  const modulation =
    Number.isFinite(minA) && Number.isFinite(maxA) && minA > 0 && maxA >= minA
      ? { minW: minA * volts, maxW: maxA * volts, stepW: volts }
      : null;
  return { minA, maxA, volts, modulation };
}

/** FR2 — the current a budget allows, on whole amps within the range. */
export function ampsFor(budgetW: number, range: CurrentRange): number {
  if (!Number.isFinite(budgetW)) return range.minA;
  return Math.min(range.maxA, Math.max(range.minA, Math.floor(budgetW / range.volts + 1e-9)));
}
