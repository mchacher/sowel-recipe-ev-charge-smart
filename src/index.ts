/**
 * Sowel recipe: ev-charge-smart (spec 001)
 *
 * One charger, one or more cars. Charges from the solar surplus through the
 * energy arbiter up to a target, guarantees a minimum by a departure time
 * from the grid, wakes a sleeping car when the charger refuses to start.
 */

import { ChargerControl } from "./charger.js";
import { ampsFor, NOMINAL_VOLTAGE, rangeOf, type CurrentRange } from "./current.js";
import { decide, type Decision, type Mode } from "./decide.js";
import { I18N, SLOTS } from "./i18n.js";
import { activeCar, readCar, readCharger, type CarView } from "./inputs.js";
import { observe, parseRate } from "./rate.js";
import type {
  CapacityClaimHandle,
  DataChangedEvent,
  RecipeContext,
  RecipeDefinition,
  RecipeInstanceHandle,
} from "./sowel-types.js";

export const RECIPE_ID = "ev-charge-smart";
export const TICK_MS = 60_000;
/** After the recipe orders the charger, give the car this long to start drawing. */
export const QUIET_MS = 120_000;
/** A denied claim is asked again after this long. */
export const CLAIM_RETRY_MS = 15 * 60_000;

export interface Params {
  chargerId: string;
  vehicleIds: string[];
  targetSoc: number;
  minSoc: number;
  departure: string;
  current: number;
  /** Spec 002 — the upper bound of the surplus current. */
  maxCurrent: number;
}

function numParam(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

export function readParams(p: Record<string, unknown>): Params {
  const vehicles = p.vehicles;
  return {
    chargerId: String(p.charger ?? ""),
    vehicleIds: Array.isArray(vehicles)
      ? vehicles.filter((v): v is string => typeof v === "string" && v !== "")
      : typeof vehicles === "string" && vehicles !== ""
        ? [vehicles]
        : [],
    targetSoc: numParam(p.target_soc, 80),
    minSoc: numParam(p.min_soc, 30),
    departure:
      typeof p.departure === "string" && /^\d{1,2}:\d{2}$/.test(p.departure)
        ? p.departure
        : "07:30",
    current: numParam(p.charge_current, 10),
    maxCurrent: numParam(p.max_current, 16),
  };
}

const MODE_LABEL: Record<Mode, string> = {
  unplugged: "Débranché",
  offline: "Borne hors ligne",
  manual: "Manuel",
  done: "Terminé",
  guarantee: "Minimum garanti",
  surplus: "Surplus",
};

function kw(watts: number): string {
  return `${(watts / 1000).toFixed(1).replace(".", ",")} kW`;
}

export function summaryOf(
  d: Decision,
  battery: number | null,
  charging: boolean,
  minSoc: number,
  powerW: number | null = null,
): string {
  const pct = battery === null ? "?" : `${Math.round(battery)} %`;
  switch (d.mode) {
    case "unplugged":
      return "Débranché";
    case "offline":
      return `Borne hors ligne · ${pct}`;
    case "manual":
      return `Manuel · ${pct}`;
    case "done":
      return `Terminé · ${pct}`;
    case "guarantee":
      return `Minimum garanti · ${pct} → ${minSoc} %`;
    case "surplus":
      return charging
        ? `☀ Surplus · ${pct} → ${d.effectiveTarget} %${powerW !== null && powerW > 0 ? ` · ${kw(powerW)}` : ""}`
        : `En attente de surplus · ${pct}`;
  }
}

/** A human (or an outside system) switching the charger — not Sowel's own retry channel. */
function isHumanSource(source: unknown): boolean {
  const s = source as { kind?: string; channel?: string } | undefined;
  if (!s) return false;
  return (
    s.kind === "manual" ||
    s.kind === "button" ||
    s.kind === "shared_access" ||
    (s.kind === "external" && s.channel !== "delivery-retry")
  );
}

interface OrderExecutedEvent {
  equipmentId: string;
  orderAlias: string;
  source?: unknown;
}

class Instance implements RecipeInstanceHandle {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly control: ChargerControl;
  private claim: CapacityClaimHandle | null = null;
  private granted = false;
  /** A denied claim is asked again after this time, not on every evaluation. */
  private claimRetryAt = 0;
  private deniedLogged: string | null = null;
  private hold: boolean;
  /** After the recipe orders the charger, a car takes a while to draw. */
  private quietUntil = 0;
  private lastMode: Mode | null = null;
  private lastActiveReason: string | null = null;
  private wasUnplugged = false;
  private stopped = false;
  private evaluating = false;
  private again = false;

  constructor(
    private readonly p: Params,
    private readonly ctx: RecipeContext,
  ) {
    this.hold = ctx.state.get("hold") === true;
    this.control = new ChargerControl({
      chargerId: p.chargerId,
      dispatch: (id, alias, value) => {
        if (id === p.chargerId) this.quietUntil = Date.now() + QUIET_MS;
        return ctx.dispatchOrder(id, alias, value);
      },
      log: (m, level) => ctx.log(m, level),
      alert: (m) => (m === null ? ctx.state.delete("alert") : ctx.state.set("alert", m)),
      now: () => Date.now(),
      later: (ms, fn) => this.later(ms, fn),
      sleep: (ms) => new Promise((resolve) => this.later(ms, resolve)),
    });

    // Restart: keep a charge the recipe owned. A charge running without that
    // record was started by someone else: manual hold.
    const charger = readCharger(ctx, p.chargerId);
    if (ctx.state.get("owned") === true) this.control.owned = true;
    else if (
      charger.state === true &&
      charger.vehicle !== "disconnected" &&
      charger.vehicle !== null
    )
      this.setHold(true);

    this.unsubscribers.push(
      ctx.eventBus.onType("equipment.data.changed", (e) => this.onData(e as DataChangedEvent)),
      ctx.eventBus.onType("equipment.order.executed", (e) => this.onOrder(e as OrderExecutedEvent)),
    );
    const tick = () => {
      this.evaluate();
      this.later(TICK_MS, tick);
    };
    this.later(0, tick);
  }

  private later(ms: number, fn: () => void): void {
    if (this.stopped) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.stopped) return;
      try {
        fn();
      } catch (err) {
        this.ctx.logger.error({ err }, "ev-charge-smart timer failed");
      }
    }, ms);
    this.timers.add(t);
  }

  private setOwned(owned: boolean): void {
    if (this.stopped) return;
    if (this.ctx.state.get("owned") !== owned) this.ctx.state.set("owned", owned);
  }

  private setHold(on: boolean): void {
    if (this.hold === on) return;
    this.hold = on;
    if (on) {
      this.control.disown();
      this.setOwned(false);
      this.ctx.log("Borne pilotée à la main : la recette se met en retrait jusqu'au débranchement");
    }
    this.ctx.state.set("hold", on);
  }

  /**
   * FR13. The charger's `state` reading cannot tell a person from the car: on
   * the dé it follows the car's draw, which stops by itself (limit, sleep,
   * schedule). A person is seen through the order they send instead.
   */
  private onOrder(e: OrderExecutedEvent): void {
    try {
      if (e.equipmentId !== this.p.chargerId || e.orderAlias !== "state") return;
      if (!isHumanSource(e.source)) return;
      this.setHold(true);
      this.evaluate();
    } catch (err) {
      this.ctx.logger.error({ err }, "ev-charge-smart order handler failed");
    }
  }

  private onData(e: DataChangedEvent): void {
    try {
      if (e.value === e.previous) return;
      const ours = e.equipmentId === this.p.chargerId || this.p.vehicleIds.includes(e.equipmentId);
      if (!ours) return;
      if (this.p.vehicleIds.includes(e.equipmentId) && e.alias === "battery_level")
        this.learn(e.equipmentId);
      this.evaluate();
    } catch (err) {
      this.ctx.logger.error({ err }, "ev-charge-smart event handler failed");
    }
  }

  private learn(carId: string): void {
    const car = readCar(this.ctx, carId);
    if (car.battery === null) return;
    const charging =
      this.control.owned && readCharger(this.ctx, this.p.chargerId).vehicle === "charging";
    const key = `rate.${carId}`;
    this.ctx.state.set(
      key,
      observe(parseRate(this.ctx.state.get(key)), car.battery, Date.now(), charging),
    );
  }

  /** Spec 002 — the range claimed with, and the current the last budget allows. */
  private range: CurrentRange | null = null;
  private budgetAmps: number | null = null;

  /** The claim is modulating: the core supports spec 185 and a range was declared. */
  private modulating(): boolean {
    return this.range?.modulation != null && typeof this.claim?.budgetW === "function";
  }

  private ensureClaim(watts: number, range: CurrentRange): void {
    if (this.claim || Date.now() < this.claimRetryAt) return;
    const energy = this.ctx.helpers.energy;
    if (!energy) {
      this.claimRetryAt = Number.POSITIVE_INFINITY;
      this.ctx.log("Arbitre d'énergie indisponible : charge sur surplus désactivée", "warn");
      return;
    }
    this.range = range;
    this.budgetAmps = null;
    this.claim = energy.claimCapacity({
      equipmentId: this.p.chargerId,
      watts,
      ...(range.modulation
        ? {
            modulation: range.modulation,
            onBudget: (w: number) => {
              this.budgetAmps = ampsFor(w, range);
              this.evaluate();
            },
          }
        : {}),
      note: "ev-charge-smart",
      onGranted: () => {
        this.granted = true;
        // Core spec 185 calls onBudget right after onGranted: decide once the
        // first budget is in, so the charge starts at its current, not at the
        // minimum and then again.
        if (range.modulation) queueMicrotask(() => this.evaluate());
        else this.evaluate();
      },
      onRevoked: (reason) => {
        this.granted = false;
        if (reason === "manual-override") this.setHold(true);
        this.evaluate();
      },
    });
    if (this.claim.status() === "denied") {
      const why = this.claim.deniedReason ?? "denied";
      this.claim = null;
      this.granted = false;
      // Every claim writes the arbiter's journal: ask again in 15 min, not on every reading.
      this.claimRetryAt = Date.now() + CLAIM_RETRY_MS;
      if (this.deniedLogged !== why) {
        this.deniedLogged = why;
        this.ctx.log(
          why === "not-profiled"
            ? "La borne n'a pas de profil énergie : charge sur surplus désactivée (le minimum garanti fonctionne)"
            : `Arbitre : demande refusée (${why}) ; le minimum garanti fonctionne`,
          "warn",
        );
      }
    } else {
      this.deniedLogged = null;
    }
  }

  private releaseClaim(): void {
    this.claimRetryAt = 0;
    this.budgetAmps = null;
    if (!this.claim) return;
    this.claim.reportNeed?.(false);
    this.claim.release();
    this.claim = null;
    this.granted = false;
  }

  /**
   * Re-entrant calls (an order makes the charger publish, which fires an event
   * while this evaluation still runs) are folded into one more pass, so an
   * outer pass never overwrites a newer one with a stale snapshot.
   */
  evaluate(): void {
    if (this.stopped) return;
    if (this.evaluating) {
      this.again = true;
      return;
    }
    this.evaluating = true;
    try {
      for (let pass = 0; pass < 5; pass++) {
        this.again = false;
        this.evaluateOnce();
        if (!this.again) break;
      }
    } finally {
      this.evaluating = false;
    }
  }

  /** Re-evaluate once an asynchronous start or stop has finished. */
  private after(work: Promise<unknown>): void {
    void work.then(() => {
      if (this.stopped) return;
      this.setOwned(this.control.owned);
      this.evaluate();
    });
  }

  private evaluateOnce(): void {
    if (this.stopped) return;
    try {
      const charger = readCharger(this.ctx, this.p.chargerId);
      const cars = this.p.vehicleIds.map((id) => readCar(this.ctx, id));
      const active = activeCar(cars, charger.vehicle);
      const car = active.car;
      const unplugged = charger.vehicle === "disconnected";

      if (unplugged) {
        if (!this.wasUnplugged) {
          this.wasUnplugged = true;
          this.setHold(false);
          this.control.resetSession();
          this.lastActiveReason = null;
        }
        // A charger left on would charge the next car (a guest's) without a decision.
        if (this.control.owned) this.after(this.control.stop("débranché"));
      } else if (charger.vehicle !== null) {
        this.wasUnplugged = false;
        if (active.reason !== this.lastActiveReason) {
          this.lastActiveReason = active.reason;
          if (active.reason === "ambiguous" || (active.reason === "none" && cars.length > 0))
            this.ctx.log("Voiture branchée non identifiée : charge sur surplus seulement", "warn");
        }
      }

      // The claim first: a grant may arrive synchronously and must be decided on.
      const watts = Math.round(this.p.current * (charger.voltage ?? NOMINAL_VOLTAGE));
      if (!unplugged && charger.vehicle !== null && !this.control.gaveUp)
        this.ensureClaim(watts, rangeOf(charger, this.p.maxCurrent));

      const rate = car ? parseRate(this.ctx.state.get(`rate.${car.id}`)).ratePctPerH : 10;
      const now = new Date();
      const d = decide({
        vehicle: charger.vehicle,
        battery: car?.battery ?? null,
        carCompleted: car?.chargingState === "completed",
        carLimit: car?.chargeLimit ?? null,
        targetSoc: this.p.targetSoc,
        minSoc: this.p.minSoc,
        departure: this.p.departure,
        offPeakNow: this.ctx.helpers.getTariff?.().isOffPeakNow ?? null,
        ratePctPerH: rate,
        manualHold: this.hold,
        refusedUntilUnplug: this.control.gaveUp,
        granted: this.granted,
        now,
      });

      // Arbiter: no need while backing off — nothing draws, others may use the surplus.
      if (d.claim === "release") this.releaseClaim();
      else this.claim?.reportNeed?.(d.need && !this.control.inBackoff());

      // Charger.
      const drawing = charger.state === true;
      if (d.charger === "run") {
        const canStart =
          !this.control.starting &&
          !this.control.inBackoff() &&
          !this.control.gaveUp &&
          Date.now() > this.quietUntil;
        if (!drawing && canStart) {
          // Spec 002 FR3 — a surplus start at the budget's current; the
          // guarantee (and an older core) at the fixed current.
          const surplusAmps =
            d.mode === "surplus" && this.modulating()
              ? (this.budgetAmps ?? this.range?.minA ?? this.p.current)
              : null;
          this.after(
            this.control.start({
              current: surplusAmps ?? this.p.current,
              currentNow: charger.current,
              wakeCars:
                active.candidates.length > 0
                  ? active.candidates
                  : cars.filter((c) => c.atHome !== false),
              refreshCar: car,
              alertOnGiveUp: d.mode === "guarantee",
            }),
          );
        } else if (drawing && !this.control.owned) {
          // Drawing on a run decision: adopt it (a grant arriving while it runs).
          this.control.owned = true;
          this.setOwned(true);
        }
      } else if (d.charger === "stop" && this.control.owned && !this.control.starting) {
        this.after(this.control.stop(MODE_LABEL[d.mode]));
      }

      // Spec 002 FR2/FR4 — follow the budget on an owned, drawing surplus charge.
      if (
        d.mode === "surplus" &&
        d.charger === "run" &&
        this.modulating() &&
        this.budgetAmps !== null &&
        this.control.owned &&
        drawing &&
        !this.control.starting &&
        charger.current !== this.budgetAmps
      ) {
        const amps = this.budgetAmps;
        void this.control.setCurrent(amps).then((ok) => {
          if (!ok) this.ctx.logger.debug({ amps }, "ev-charge-smart: charge current not applied");
        });
      }

      this.departureCheck(car, now);
      this.publish(d, car, charger.vehicle === "charging", charger.power);
    } catch (err) {
      this.ctx.logger.error({ err }, "ev-charge-smart evaluation failed");
    }
  }

  /** FR9: at departure, below the minimum → one alert per day (kept across restarts). */
  private departureCheck(car: CarView | null, now: Date): void {
    if (!car || car.battery === null || this.p.minSoc <= 0) return;
    const [h, m] = this.p.departure.split(":").map(Number);
    const dep = new Date(now);
    dep.setHours(h, m, 0, 0);
    const key = dep.toDateString();
    if (now < dep || now.getTime() - dep.getTime() > TICK_MS * 5) return;
    if (this.ctx.state.get("departure_checked") === key) return;
    this.ctx.state.set("departure_checked", key);
    if (car.battery < this.p.minSoc) {
      const msg = `${car.name} : ${Math.round(car.battery)} % au départ, sous le minimum de ${this.p.minSoc} %`;
      this.ctx.log(msg, "warn");
      this.ctx.state.set("alert", msg);
    }
  }

  private publish(
    d: Decision,
    car: CarView | null,
    charging: boolean,
    powerW: number | null = null,
  ): void {
    if (d.mode !== this.lastMode) {
      this.lastMode = d.mode;
      this.ctx.log(`Mode : ${MODE_LABEL[d.mode]}`);
      this.ctx.state.set("mode", d.mode);
    }
    const summary = this.control.gaveUp
      ? `Terminé · la voiture ne demande plus`
      : this.control.inBackoff() && d.charger === "run"
        ? "Voiture non réveillée · nouvel essai"
        : summaryOf(d, car?.battery ?? null, charging, this.p.minSoc, powerW);
    if (this.ctx.state.get("summary") !== summary) this.ctx.state.set("summary", summary);
    const activeId = car?.id ?? null;
    if (this.ctx.state.get("active_vehicle") !== activeId)
      this.ctx.state.set("active_vehicle", activeId);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const u of this.unsubscribers) u();
    this.releaseClaim();
  }
}

export function createRecipe(): RecipeDefinition {
  return {
    id: RECIPE_ID,
    name: "Smart EV charging",
    description:
      "Charges from the solar surplus up to a target, guarantees a minimum by departure, wakes a sleeping car.",
    slots: SLOTS,
    tile: { icon: "Zap" },
    i18n: I18N,
    validate(params, ctx) {
      const p = readParams(params);
      const charger = ctx.equipmentManager.getById(p.chargerId);
      if (!charger) throw new Error("Charger not found");
      if (charger.type !== "ev_charger")
        throw new Error("The charger must be an EV charger equipment");
      for (const id of p.vehicleIds) {
        const car = ctx.equipmentManager.getById(id);
        if (!car) throw new Error("Vehicle not found");
        if (car.type !== "electric_vehicle")
          throw new Error(`${car.name} is not an electric vehicle equipment`);
      }
      if (p.minSoc > p.targetSoc)
        throw new Error("The guaranteed minimum cannot exceed the target");
      if (p.current < 6) throw new Error("The charge current must be at least 6 A");
    },
    createInstance(params, ctx) {
      return new Instance(readParams(params), ctx);
    },
  };
}
