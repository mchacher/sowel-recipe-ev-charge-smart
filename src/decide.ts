/**
 * The decision table of spec 001 ("Architecture"). Pure: a snapshot in, what
 * to do out. Every row is a unit test.
 */

export type VehicleState = "disconnected" | "connected" | "charging";

export type Mode = "unplugged" | "offline" | "manual" | "done" | "guarantee" | "surplus";

export interface DecideInput {
  /** The charger's `vehicle` reading; null when the charger is offline or unknown. */
  vehicle: VehicleState | null;
  /** The active car's battery level, null when unknown (FR2). */
  battery: number | null;
  /** The car says its charge is complete. */
  carCompleted: boolean;
  /** The car's own charge limit, when it publishes one. */
  carLimit: number | null;
  targetSoc: number;
  minSoc: number;
  /** "HH:MM", local time. */
  departure: string;
  offPeakNow: boolean | null;
  ratePctPerH: number;
  manualHold: boolean;
  /** The car refused two starts in this plug-in session: it wants no more. */
  refusedUntilUnplug: boolean;
  granted: boolean;
  now: Date;
}

export interface Decision {
  mode: Mode;
  /** What the charger should be doing. "leave" = do not touch it. */
  charger: "run" | "stop" | "leave";
  /** Keep (or open) the arbiter claim, or release it. */
  claim: "keep" | "release";
  need: boolean;
  effectiveTarget: number;
  /** Set when a guarantee is pending (battery known and below the minimum). */
  latestStart: Date | null;
}

/** Guarantee starts this long before the computed time, for safety. */
export const GUARANTEE_MARGIN_MS = 30 * 60_000;

/** The next occurrence of "HH:MM" strictly after `now` (local time). */
export function nextDeparture(departure: string, now: Date): Date {
  const [h, m] = departure.split(":").map((x) => Number(x));
  const d = new Date(now);
  d.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 30, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export function effectiveTargetOf(targetSoc: number, carLimit: number | null): number {
  return carLimit !== null && carLimit < targetSoc ? carLimit : targetSoc;
}

export function decide(i: DecideInput): Decision {
  const effectiveTarget = effectiveTargetOf(i.targetSoc, i.carLimit);
  const base = { effectiveTarget, latestStart: null as Date | null };

  // 1. Unplugged. An offline charger is not an unplugged one: nothing changes,
  // the manual hold and the ownership survive, only the need is withdrawn.
  if (i.vehicle === "disconnected")
    return { ...base, mode: "unplugged", charger: "leave", claim: "release", need: false };
  if (i.vehicle === null)
    return { ...base, mode: "offline", charger: "leave", claim: "keep", need: false };

  // 2. Manual hold: the user switched the charger; leave it alone.
  if (i.manualHold)
    return { ...base, mode: "manual", charger: "leave", claim: "keep", need: false };

  // 3. Done (including a car that refused twice: full at its own limit, or scheduled).
  if (
    i.carCompleted ||
    i.refusedUntilUnplug ||
    (i.battery !== null && i.battery >= effectiveTarget)
  )
    return { ...base, mode: "done", charger: "stop", claim: "release", need: false };

  // 4. Guarantee.
  let latestStart: Date | null = null;
  if (i.battery !== null && i.minSoc > 0 && i.battery < i.minSoc) {
    const hours = (i.minSoc - i.battery) / Math.max(i.ratePctPerH, 0.1);
    latestStart = new Date(
      nextDeparture(i.departure, i.now).getTime() - hours * 3_600_000 - GUARANTEE_MARGIN_MS,
    );
    if (i.offPeakNow === true || i.now.getTime() >= latestStart.getTime())
      return {
        effectiveTarget,
        latestStart,
        mode: "guarantee",
        charger: "run",
        claim: "keep",
        need: true,
      };
  }

  // 5. Surplus.
  return {
    effectiveTarget,
    latestStart,
    mode: "surplus",
    charger: i.granted ? "run" : "stop",
    claim: "keep",
    need: true,
  };
}
