/**
 * Starting and stopping the charger (spec 001 FR10–FR12): current, start,
 * wake and retry when a sleeping car makes the charger refuse, refresh after
 * a start, back-off after repeated failures.
 */

import type { CarView } from "./inputs.js";
import type { DispatchResult } from "./sowel-types.js";

export const WAKE_WAIT_MS = 30_000;
export const MAX_WAKES = 2;
export const BACKOFF_MS = 15 * 60_000;
export const REFRESH_AFTER_MS = 60_000;
/** Failed start sequences (each with its wakes) before giving up until unplug. */
export const MAX_FAILED_STARTS = 2;

export interface ChargerDeps {
  chargerId: string;
  dispatch(equipmentId: string, alias: string, value: unknown): Promise<DispatchResult>;
  log(message: string, level?: "info" | "warn" | "error"): void;
  /** A notifiable alert (state key), or null to clear it. */
  alert(message: string | null): void;
  now(): number;
  /** Timers owned by the instance, cleared on stop. */
  later(ms: number, fn: () => void): void;
  sleep(ms: number): Promise<void>;
}

export interface StartRequest {
  current: number;
  currentNow: number | null;
  /** Cars a wake goes to (the candidates on the charger). */
  wakeCars: CarView[];
  /** The car to refresh 60 s after a start. */
  refreshCar: CarView | null;
  /** Raise the alert when giving up (the guaranteed minimum is at risk). */
  alertOnGiveUp: boolean;
}

export class ChargerControl {
  /** The recipe started the charge that is running. */
  owned = false;
  /** Two failed starts in this plug-in session: stop trying until unplug. */
  gaveUp = false;
  private busy = false;
  private backoffUntil = 0;
  private failures = 0;

  constructor(private readonly deps: ChargerDeps) {}

  get starting(): boolean {
    return this.busy;
  }

  inBackoff(): boolean {
    return this.deps.now() < this.backoffUntil;
  }

  /** A new plug-in session: forget failures and the give-up. */
  resetSession(): void {
    this.failures = 0;
    this.gaveUp = false;
    this.backoffUntil = 0;
  }

  /** A dispatch that never throws: a throw (integration down) is a failure without a reason from the device. */
  private async send(
    alias: string,
    value: unknown,
    equipmentId = this.deps.chargerId,
  ): Promise<DispatchResult & { thrown?: boolean }> {
    try {
      return await this.deps.dispatch(equipmentId, alias, value);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        thrown: true,
      };
    }
  }

  /** Returns true when the charge started. Never throws. */
  async start(req: StartRequest): Promise<boolean> {
    if (this.busy || this.gaveUp || this.inBackoff()) return false;
    this.busy = true;
    try {
      if (req.currentNow !== req.current) {
        const r = await this.send("charge_current", req.current);
        if (!r.success)
          this.deps.log(`Réglage du courant à ${req.current} A refusé : ${r.error ?? "?"}`, "warn");
      }
      let r = await this.send("state", true);
      if (r.thrown) {
        this.deps.log(`Borne indisponible : ${r.error ?? "?"}`, "warn");
        return false;
      }
      const wakeable = req.wakeCars.filter((c) => c.hasWake);
      for (let attempt = 1; !r.success && attempt <= MAX_WAKES && wakeable.length > 0; attempt++) {
        this.deps.log(
          `La borne refuse de démarrer (${r.error ?? "?"}) : réveil de ${wakeable.map((c) => c.name).join(", ")} (essai ${attempt})`,
        );
        for (const car of wakeable) {
          const w = await this.send("wake", null, car.id);
          if (!w.success) this.deps.log(`Réveil de ${car.name} refusé : ${w.error ?? "?"}`, "warn");
        }
        await this.deps.sleep(WAKE_WAIT_MS);
        r = await this.send("state", true);
      }
      if (!r.success) {
        this.failures++;
        if (this.failures >= MAX_FAILED_STARTS) {
          this.gaveUp = true;
          const msg = `La voiture ne demande plus de courant (${r.error ?? "?"}) : plus d'essai jusqu'au débranchement.`;
          this.deps.log(msg, "warn");
          if (req.alertOnGiveUp) this.deps.alert(msg);
        } else {
          this.backoffUntil = this.deps.now() + BACKOFF_MS;
          this.deps.log(
            `La charge n'a pas démarré : ${r.error ?? "?"}. Nouvel essai dans 15 min.`,
            "warn",
          );
        }
        return false;
      }
      this.failures = 0;
      this.owned = true;
      this.deps.alert(null);
      this.deps.log(`Charge démarrée à ${req.current} A`);
      const car = req.refreshCar;
      if (car?.hasRefresh)
        this.deps.later(REFRESH_AFTER_MS, () => {
          void this.send("refresh", null, car.id);
        });
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** Stops the charge when the recipe owns it. Never throws. */
  async stop(reason: string): Promise<void> {
    if (!this.owned || this.busy) return;
    this.busy = true;
    try {
      const r = await this.send("state", false);
      if (r.success) {
        this.owned = false;
        this.deps.log(`Charge arrêtée (${reason})`);
      } else {
        this.deps.log(`Arrêt de la charge refusé : ${r.error ?? "?"}`, "warn");
      }
    } finally {
      this.busy = false;
    }
  }

  /** Forget ownership (unplugged, manual hold). */
  disown(): void {
    this.owned = false;
  }
}
