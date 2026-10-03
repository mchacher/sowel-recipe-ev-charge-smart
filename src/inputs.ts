/**
 * Reads the charger and the cars through the core contract aliases (core
 * specs 182, 183, 184) and works out the active car (spec 001 FR1).
 */

import type { VehicleState } from "./decide.js";
import type { RecipeContext } from "./sowel-types.js";

export interface ChargerView {
  id: string;
  /** Charger switched on. */
  state: boolean | null;
  vehicle: VehicleState | null;
  voltage: number | null;
  current: number | null;
  /** Live power, for the tile. */
  power: number | null;
  /** Bounds of the `charge_current` order (spec 002). */
  currentMin: number | null;
  currentMax: number | null;
}

export interface CarView {
  id: string;
  name: string;
  battery: number | null;
  plugged: boolean | null;
  atHome: boolean | null;
  chargingState: string | null;
  chargeLimit: number | null;
  hasWake: boolean;
  hasRefresh: boolean;
}

export type ActiveReason = "single" | "charging" | "only-configured" | "ambiguous" | "none";

export interface ActiveCar {
  car: CarView | null;
  /** Cars that may be on the charger: the ones a wake goes to. */
  candidates: CarView[];
  reason: ActiveReason;
}

const VEHICLE_STATES: readonly string[] = ["disconnected", "connected", "charging"];

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "ON" || v === "on" || v === "true" || v === 1) return true;
  if (v === "OFF" || v === "off" || v === "false" || v === 0) return false;
  return null;
}

function values(ctx: RecipeContext, id: string): Map<string, unknown> {
  try {
    return new Map(
      ctx.equipmentManager.getDataBindingsWithValues(id).map((b) => [b.alias, b.value]),
    );
  } catch {
    return new Map();
  }
}

function currentOrderBounds(
  ctx: RecipeContext,
  id: string,
): { min: number | null; max: number | null } {
  try {
    const order = (ctx.equipmentManager.getOrderBindingsWithDetails?.(id) ?? []).find(
      (o) => o.alias === "charge_current",
    );
    return { min: order?.min ?? null, max: order?.max ?? null };
  } catch {
    return { min: null, max: null };
  }
}

function orderAliases(ctx: RecipeContext, id: string): Set<string> {
  try {
    return new Set(
      (ctx.equipmentManager.getOrderBindingsWithDetails?.(id) ?? []).map((o) => o.alias),
    );
  } catch {
    return new Set();
  }
}

export function readCharger(ctx: RecipeContext, id: string): ChargerView {
  const v = values(ctx, id);
  const bounds = currentOrderBounds(ctx, id);
  const vehicle = v.get("vehicle");
  return {
    id,
    state: bool(v.get("state")),
    vehicle:
      typeof vehicle === "string" && VEHICLE_STATES.includes(vehicle)
        ? (vehicle as VehicleState)
        : null,
    voltage: num(v.get("voltage")),
    current: num(v.get("charge_current")),
    power: num(v.get("power")),
    currentMin: bounds.min,
    currentMax: bounds.max,
  };
}

export function readCar(ctx: RecipeContext, id: string): CarView {
  const v = values(ctx, id);
  const orders = orderAliases(ctx, id);
  const state = v.get("charging_state");
  return {
    id,
    name: ctx.equipmentManager.getById(id)?.name ?? id,
    battery: num(v.get("battery_level")),
    plugged: bool(v.get("plugged")),
    atHome: bool(v.get("at_home")),
    chargingState: typeof state === "string" ? state : null,
    chargeLimit: num(v.get("charge_limit")),
    hasWake: orders.has("wake"),
    hasRefresh: orders.has("refresh"),
  };
}

/** FR1: which car is on the charger. */
export function activeCar(cars: CarView[], vehicle: VehicleState | null): ActiveCar {
  const candidates = cars.filter((c) => c.plugged === true && c.atHome !== false);
  if (candidates.length === 1) return { car: candidates[0], candidates, reason: "single" };
  if (candidates.length > 1) {
    const busy = candidates.filter(
      (c) => c.chargingState === "charging" || c.chargingState === "waiting",
    );
    if (busy.length === 1) return { car: busy[0], candidates, reason: "charging" };
    return { car: null, candidates, reason: "ambiguous" };
  }
  // None reported plugged. With one car configured, its data may just be stale.
  if (
    cars.length === 1 &&
    vehicle !== null &&
    vehicle !== "disconnected" &&
    cars[0].atHome !== false
  )
    return { car: cars[0], candidates: [cars[0]], reason: "only-configured" };
  return { car: null, candidates: [], reason: "none" };
}
