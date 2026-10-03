/**
 * The charge rate in % per hour, learned per car while the recipe charges
 * (spec 001 FR8). Pure: the caller stores the memory in the instance state.
 */

export const DEFAULT_RATE_PCT_PER_H = 10;
/** Two readings closer than this say more about rounding than about the rate. */
export const MIN_SPAN_MS = 30 * 60_000;
const KEEP = 0.7;

export interface RateMemory {
  ratePctPerH: number;
  /** The reading the next observation is measured from. */
  anchor: { soc: number; atMs: number } | null;
}

export function initialRate(): RateMemory {
  return { ratePctPerH: DEFAULT_RATE_PCT_PER_H, anchor: null };
}

/** Parse what the state store holds; anything odd starts over. */
export function parseRate(raw: unknown): RateMemory {
  const r = raw as Partial<RateMemory> | null;
  if (!r || typeof r.ratePctPerH !== "number" || !(r.ratePctPerH > 0)) return initialRate();
  const a = r.anchor;
  const anchor =
    a && typeof a.soc === "number" && typeof a.atMs === "number"
      ? { soc: a.soc, atMs: a.atMs }
      : null;
  return { ratePctPerH: r.ratePctPerH, anchor };
}

/**
 * A new battery reading. While charging, a reading at least 30 min after the
 * anchor with a gain updates the rate; when not charging, the anchor is
 * dropped so idle time never dilutes the rate.
 */
export function observe(mem: RateMemory, soc: number, atMs: number, charging: boolean): RateMemory {
  if (!charging) return { ratePctPerH: mem.ratePctPerH, anchor: null };
  if (!mem.anchor || soc < mem.anchor.soc)
    return { ratePctPerH: mem.ratePctPerH, anchor: { soc, atMs } };
  const span = atMs - mem.anchor.atMs;
  if (span < MIN_SPAN_MS) return mem;
  const gain = soc - mem.anchor.soc;
  if (gain <= 0) return { ratePctPerH: mem.ratePctPerH, anchor: { soc, atMs } };
  const observed = gain / (span / 3_600_000);
  return { ratePctPerH: KEEP * mem.ratePctPerH + (1 - KEEP) * observed, anchor: { soc, atMs } };
}
