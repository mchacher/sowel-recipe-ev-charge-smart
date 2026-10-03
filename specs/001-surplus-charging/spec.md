# Spec 001 — Smart EV charging: solar surplus, guaranteed minimum, wake

- **Status**: Draft
- **Date**: 2026-10-03
- **Related**: core spec 182 (`ev_charger` contract), core spec 183 (`electric_vehicle` contract), core spec 184 (`refresh` order), core spec 140 (energy capacity arbiter), core spec 166 (`reportNeed`), core spec 138 (tariff helper); `sowel-plugin-tuya` (the dé charger), `sowel-plugin-renault` (the cars)
- **Installation**: one dé charger (single phase, 6–16 A); a Renault Rafale plug-in hybrid now, a Megane E-Tech soon — two cars, one charger

## Context

The owner charges a car on a charger Sowel drives, and wants the charge to come from the solar surplus — while being sure the car has enough for tomorrow morning. Three facts, measured on the installation on 2026-10-03, shape the recipe:

1. **The charger does not know the battery level; the car does.** The charger (spec 182) knows whether a car is plugged and drawing; the car (spec 183) reports its battery level, its own charge limit and whether it is plugged, through its maker's cloud, every 10 minutes.
2. **A car that paused its charge falls asleep within minutes, and a sleeping car ignores the charger.** Switching the charger on is then refused ("the vehicle is not asking for current"). The car's `wake` order (spec 183) wakes it; the charger accepts the start seconds later (measured: start accepted 22 s after `wake`, 2.1 kW 16 s later).
3. **The car's data lags.** Its cloud is polled every 10 minutes; the car reports within a minute of a charge starting. The `refresh` order (core spec 184) reads it on demand.

The energy arbiter (spec 140) decides which flexible loads may use the surplus. It grants binary claims (run / don't run) at a declared power; it does not modulate a load's power yet (a later core spec, "modulating claim").

## Goals

1. Charge from the solar surplus, through the arbiter, up to a **target battery level** (default 80 %).
2. **Guarantee a minimum battery level by a departure time** (default 30 % by 07:30): below it, charge from the grid — off-peak hours first, then whatever time is left.
3. **Wake a sleeping car** when the charger refuses to start, and **refresh** the car's data after a start.
4. Serve **several cars on one charger**: the recipe works out which one is plugged.
5. Never fight the user: a charge switched by hand is left alone until the car is unplugged.

## Non-goals

- **Modulating the current with the surplus.** The current is a fixed parameter; the arbiter grants or not. Modulation waits for the core "modulating claim" spec.
- **Filling to the target from the grid.** The grid is used to reach the minimum only; above it, only the surplus charges. (A later option.)
- **Changing the car's own charge limit.** The recipe reads it (it never aims above it) but does not write it.
- **Several chargers per instance.** One instance per charger.
- **Battery capacity in kWh.** Not needed: the time to reach the minimum is estimated from the charge rate the recipe observes, in % per hour.

## Parameters (slots)

| Slot             | Type                               | Required | Default | Meaning                                                                        |
| ---------------- | ---------------------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `charger`        | equipment `ev_charger`             | yes      | —       | The charger to drive                                                           |
| `vehicles`       | equipment `electric_vehicle`, list | no       | —       | Cars that charge on it. Without any, the recipe charges on surplus only (no %) |
| `target_soc`     | number %, 20–100                   | yes      | 80      | Surplus charging stops here (or at the car's own limit, if lower)              |
| `min_soc`        | number %, 0–100                    | yes      | 30      | Guaranteed by `departure`, from the grid if needed. 0 disables the guarantee   |
| `departure`      | time                               | yes      | 07:30   | When the minimum must be reached, every day                                    |
| `charge_current` | number A, 6–32                     | yes      | 10      | The current the charger is set to when the recipe starts it                    |

Validation: `min_soc` ≤ `target_soc`; the charger exists and is an `ev_charger`; every vehicle is an `electric_vehicle`.

## Functional requirements

### Which car

- **FR1 — Active car.** Candidates are the configured vehicles with `plugged` true and `at_home` not false. One candidate is the active car. With several, the one whose `charging_state` is `charging` or `waiting`; still several: ambiguous. None while the charger reads a vehicle connected: when exactly one vehicle is configured, it is the active car (its data may simply be stale); otherwise unknown.
- **FR2 — Battery level.** The active car's `battery_level`. Unknown (no vehicles, ambiguous, or no value) means: surplus charging only, no guarantee, logged once per plug-in.
- **FR3 — Effective target.** `min(target_soc, car charge_limit)` when the car publishes `charge_limit`; else `target_soc`.

### What to do (evaluated every minute and on every relevant change)

- **FR4 — Unplugged.** Charger `vehicle` = `disconnected`: release the claim, clear the manual hold, and switch the charger off if the recipe had started it — a charger left on would charge the next car (a guest's) without a decision.
- **FR5 — Done.** Battery ≥ effective target, or the car reports `completed`: stop the charger if the recipe started it, release the claim (`reportNeed(false)`).
- **FR6 — Guarantee.** Battery < `min_soc` and either (a) off-peak hours now (tariff configured), or (b) now ≥ the latest start: `departure` − (`min_soc` − battery) / rate − 30 min. Charge from the grid regardless of the arbiter: the claim stays open (spec 140 author rule for a hard quota), and a revoke does not stop the charge.
- **FR7 — Surplus.** Otherwise, battery < effective target (or unknown): keep a claim on the charger at `charge_current` × voltage (measured `voltage`, else 230 V), `reportNeed(true)`. `onGranted` starts the charge, `onRevoked` stops it at once.
- **FR8 — Rate.** The charge rate in % per hour is learned per car while the recipe charges: between two battery readings at least 30 min apart, smoothed (new = 0.7 × old + 0.3 × observed). Starts at 10 %/h. Stored in the instance state.
- **FR9 — Departure missed.** At `departure`, battery still < `min_soc`: a warning in the recipe log and the `alert` state key (notifiable).

### Starting and stopping

- **FR10 — Start.** Set `charge_current` if the charger's current differs, then `state` on. Success: the recipe owns the charge; 60 s later it sends `refresh` to the active car (when bound).
- **FR11 — Wake.** If `state` on fails (`{success:false}` — a sleeping car makes the charger refuse) and a candidate car has `wake` bound: `wake` every candidate, wait 30 s, retry `state` on. At most two wakes per start. Still failing: no new start for 15 min (the need reported to the arbiter drops meanwhile). A second failed start in the same plug-in session means the car wants no more (full at its own limit, or scheduled): the recipe gives up until the car is unplugged (mode `done`), and sets `alert` only when the guaranteed minimum is at stake. A thrown dispatch (integration unavailable) is not followed by a wake.
- **FR11b — Car stopping by itself.** On the dé, the charger's `state` reads "the car is drawing" and drops by itself when the car pauses, sleeps or completes. While the decision is to run, a charge that stopped drawing is restarted (with FR11's wake) once the 2-min window after the recipe's last order has passed.
- **FR12 — Stop.** `state` off, only when the recipe started the charge.
- **FR13 — Manual hold.** A person switches the charger — an `equipment.order.executed` on its `state` with a manual, button, shared-access or external source (not the delivery-retry channel) — or the arbiter revokes with `manual-override`: the recipe stops acting on the charger until it reads `vehicle` = `disconnected` (FR4). The charger's `state` reading is never used for this: it follows the car's draw. A switch on the charger's own buttons is not seen (it sends no Sowel order).

### Visibility

- **FR14 — Tile.** `summary`: mode and numbers, e.g. "☀ Surplus · 45 % → 80 %", "Off-peak · minimum 30 %", "Done · 80 %", "Waiting for surplus · 45 %", "Unplugged", "Manual", "Car did not wake". FR/EN via the recipe's i18n.
- **FR15 — Log.** One line per decision change (start, stop, wake, mode), never one per tick.

## Acceptance criteria

- [x] AC1 — Surplus granted → the charger starts at `charge_current`; revoked → it stops within one evaluation.
- [x] AC2 — Battery reaches the effective target → charge stopped, claim released; the car's own lower limit is honoured.
- [x] AC3 — Below the minimum at night with off-peak hours → charges off-peak; without a tariff → starts at the latest start computed from the learned rate.
- [x] AC4 — Charger refuses (sleeping car) → `wake`, retry, charge starts; two failed wakes → back-off and `alert`.
- [x] AC5 — `refresh` sent to the car 60 s after every start.
- [x] AC6 — Two cars configured, one plugged → that one is the active car; both plugged, one charging → that one.
- [x] AC7 — Charger switched by hand → the recipe stays out until unplug.
- [ ] AC8 — Live on the owner's installation (Rafale + dé): a surplus start, a stop, a wake from sleep.

## Edge cases

| Case                                         | Expected                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No vehicles configured                       | Surplus charging until the car stops drawing; no guarantee                                                               |
| Charger has no energy profile                | Claim denied `not-profiled`: logged once, tile says so; guarantee still works                                            |
| Arbiter disabled                             | Same as above (`arbiter-disabled`)                                                                                       |
| Car data hours old (car asleep)              | Used as is; a start triggers `refresh`, which brings fresh data                                                          |
| Car not `at_home` but charger says connected | Another car (a guest): battery unknown, surplus only                                                                     |
| Charger offline (`vehicle` unknown)          | Mode `offline`: nothing changes (hold and ownership kept), need withdrawn; a thrown dispatch is logged and retried later |
| Arbiter denies the claim                     | Logged once per reason; asked again every 15 min, not on every reading                                                   |
| Departure passed with minimum unreached      | FR9 alert; the next day's departure applies                                                                              |
| `min_soc` = 0                                | No guarantee, surplus only                                                                                               |
| Recipe restarted mid-charge                  | Reads the charger: on and charging with the recipe's state saying it owned it → keeps ownership; otherwise manual hold   |
