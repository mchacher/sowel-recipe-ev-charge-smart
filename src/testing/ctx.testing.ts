/**
 * A fake recipe context: equipments with data and order aliases, an order
 * recorder with scripted answers, an event bus, a fake arbiter and tariff.
 */

import type {
  CapacityClaimHandle,
  CapacityClaimRequest,
  DispatchResult,
  RecipeContext,
} from "../sowel-types.js";

export interface FakeEquipment {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  orders: string[];
}

export interface OrderCall {
  equipmentId: string;
  alias: string;
  value: unknown;
}

export class FakeWorld {
  readonly equipments = new Map<string, FakeEquipment>();
  readonly orders: OrderCall[] = [];
  readonly logs: { message: string; level: string }[] = [];
  readonly state = new Map<string, unknown>();
  readonly claims: (CapacityClaimRequest & { handle: CapacityClaimHandle; need: boolean[] })[] = [];
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  /** Scripted answers: return a result, or undefined for the default (success + reflect). */
  answer: (call: OrderCall) => DispatchResult | "throw" | undefined = () => undefined;
  arbiter: "on" | "absent" | "not-profiled" = "on";
  /** The car on the charger: draws when switched on, refuses while asleep, refuses for good when full. */
  car_: "awake" | "asleep" | "full" = "awake";
  /** Synchronous grant inside claimCapacity (the arbiter may do that). */
  grantOnClaim = false;
  /** Core spec 185: handles carry budgetW(); false = an older core. */
  core185 = true;
  /** False: the charger never echoes a current order (unconfirmed / null reading). */
  reflectCurrent = true;
  /** Bounds of the charger's `charge_current` order. */
  currentBounds: { min?: number; max?: number } = { min: 6, max: 16 };
  offPeakNow: boolean | null = null;

  add(e: FakeEquipment): this {
    this.equipments.set(e.id, e);
    return this;
  }

  charger(data: Record<string, unknown> = {}): this {
    return this.add({
      id: "charger",
      name: "Borne",
      type: "ev_charger",
      data: { state: false, vehicle: "connected", voltage: 230, charge_current: 10, ...data },
      orders: ["state", "charge_current"],
    });
  }

  car(
    id: string,
    data: Record<string, unknown> = {},
    orders = ["wake", "refresh", "charge_limit"],
  ): this {
    return this.add({
      id,
      name: id,
      type: "electric_vehicle",
      data: { battery_level: 50, plugged: true, at_home: true, charging_state: "waiting", ...data },
      orders,
    });
  }

  /** A person switching the charger from Sowel: the order event, then the device. */
  userOrder(value: boolean): void {
    for (const h of this.handlers.get("equipment.order.executed") ?? [])
      h({
        type: "equipment.order.executed",
        equipmentId: "charger",
        orderAlias: "state",
        value,
        source: { kind: "manual", userId: "u" },
      });
    this.set("charger", "state", value);
    this.set("charger", "vehicle", value ? "charging" : "connected");
  }

  /** The car stops drawing by itself (limit, sleep, schedule): the dé reports state off. */
  carStops(): void {
    this.set("charger", "state", false);
    this.set("charger", "vehicle", "connected");
  }

  /** Change a value and fire `equipment.data.changed`, like the core. */
  set(equipmentId: string, alias: string, value: unknown): void {
    const eq = this.equipments.get(equipmentId)!;
    const previous = eq.data[alias];
    eq.data[alias] = value;
    for (const h of this.handlers.get("equipment.data.changed") ?? [])
      h({ type: "equipment.data.changed", equipmentId, alias, value, previous });
  }

  lastClaim() {
    return this.claims.at(-1);
  }

  grant(): void {
    const c = this.lastClaim()!;
    c.onGranted();
  }

  budgetW: number | null = null;

  /** The arbiter assigns a budget (spec 185). */
  budget(watts: number): void {
    this.budgetW = watts;
    this.lastClaim()!.onBudget?.(watts);
  }

  revoke(reason = "surplus-deficit"): void {
    this.lastClaim()!.onRevoked(reason);
  }

  ordersTo(alias: string, equipmentId?: string): OrderCall[] {
    return this.orders.filter(
      (o) => o.alias === alias && (!equipmentId || o.equipmentId === equipmentId),
    );
  }

  ctx(): RecipeContext {
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    return {
      eventBus: {
        onType: (type, handler) => {
          const list = this.handlers.get(type) ?? [];
          list.push(handler);
          this.handlers.set(type, list);
          return () =>
            this.handlers.set(
              type,
              (this.handlers.get(type) ?? []).filter((h) => h !== handler),
            );
        },
      },
      equipmentManager: {
        getById: (id) => {
          const e = this.equipments.get(id);
          return e ? { id: e.id, name: e.name, type: e.type } : null;
        },
        getDataBindingsWithValues: (id) =>
          Object.entries(this.equipments.get(id)?.data ?? {}).map(([alias, value]) => ({
            alias,
            value,
          })),
        getOrderBindingsWithDetails: (id) =>
          (this.equipments.get(id)?.orders ?? []).map((alias) =>
            id === "charger" && alias === "charge_current"
              ? { alias, ...this.currentBounds }
              : { alias },
          ),
      },
      logger,
      state: {
        get: (k) => this.state.get(k) ?? null,
        set: (k, v) => void this.state.set(k, v),
        delete: (k) => void this.state.delete(k),
      },
      log: (message, level = "info") => void this.logs.push({ message, level }),
      helpers: {
        getTariff: () => ({
          configured: this.offPeakNow !== null,
          offPeakToday: [],
          isOffPeakNow: this.offPeakNow,
        }),
        energy:
          this.arbiter === "absent"
            ? undefined
            : {
                claimCapacity: (req) => {
                  let status: "pending" | "granted" | "denied" | "released" =
                    this.arbiter === "not-profiled" ? "denied" : "pending";
                  const need: boolean[] = [];
                  const handle: CapacityClaimHandle = {
                    id: `claim-${this.claims.length + 1}`,
                    status: () => status,
                    deniedReason: this.arbiter === "not-profiled" ? "not-profiled" : undefined,
                    release: () => {
                      status = "released";
                    },
                    reportNeed: (n) => void need.push(n),
                    ...(this.core185
                      ? { budgetW: () => (status === "granted" ? this.budgetW : null) }
                      : {}),
                  };
                  this.claims.push({ ...req, handle, need });
                  if (this.grantOnClaim && status === "pending") {
                    status = "granted";
                    req.onGranted();
                  }
                  return handle;
                },
              },
      },
      dispatchOrder: async (equipmentId, alias, value) => {
        const call = { equipmentId, alias, value };
        this.orders.push(call);
        const scripted = this.answer(call);
        if (scripted === "throw") throw new Error("Integration disconnected");
        if (scripted) return scripted;
        // The dé: `state` reads "the car draws". A start is refused by a car that
        // does not ask for current (asleep, full), as the plugin reports it.
        for (const h of this.handlers.get("equipment.order.executed") ?? [])
          h({
            type: "equipment.order.executed",
            equipmentId,
            orderAlias: alias,
            value,
            source: { kind: "recipe" },
          });
        const eq = this.equipments.get(equipmentId);
        if (alias === "wake" && this.car_ === "asleep") this.car_ = "awake";
        if (eq && alias === "charge_current" && this.reflectCurrent)
          this.set(equipmentId, "charge_current", value);
        if (eq && eq.type === "ev_charger" && alias === "state") {
          if (value === true) {
            if (this.car_ !== "awake")
              return {
                success: false,
                error: "Order charge not reflected: the vehicle is not asking for current",
              };
            this.set(equipmentId, "state", true);
            this.set(equipmentId, "vehicle", "charging");
          } else {
            this.set(equipmentId, "state", false);
            if (eq.data.vehicle === "charging") this.set(equipmentId, "vehicle", "connected");
          }
        }
        return { success: true };
      },
    };
  }
}
