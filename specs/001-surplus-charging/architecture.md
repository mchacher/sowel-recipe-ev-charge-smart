# Spec 001 — Architecture

```
createRecipe() → RecipeDefinition (id "ev-charge-smart", slots, i18n fr)
  createInstance(params, ctx) → Instance
     ├─ inputs.ts     read charger + vehicles through ctx.equipmentManager (aliases of the core contracts)
     ├─ decide.ts     PURE: (inputs, params, tariff, clock, memory) → Decision {mode, run, claim, reason}
     ├─ charger.ts    start (current, state on, wake + retry, refresh) / stop; ownership; back-off
     ├─ rate.ts       PURE: learned % per hour per car
     └─ index.ts      lifecycle: 60 s tick + equipment.data.changed (charger, vehicles), claim handle, tile, log
```

- **Pure core.** `decide()` takes a snapshot and returns what should happen; it never touches `ctx`. Every FR of the decision table is a unit test on it.
- **Ctx only at the edges.** `inputs.ts` reads, `charger.ts` dispatches, `index.ts` wires timers and callbacks. Types mirrored from the core in `src/sowel-types.ts` (recipes never import the core).

## Contracts used (by alias — the core's contract-first binding names them)

| Equipment          | Alias                                  | Side  | Use                                          |
| ------------------ | -------------------------------------- | ----- | -------------------------------------------- |
| `ev_charger`       | `state`                                | data  | Charger on/off (manual-hold detection)       |
|                    | `vehicle`                              | data  | `disconnected` / `connected` / `charging`    |
|                    | `voltage`                              | data  | Claim watts (else 230 V)                     |
|                    | `charge_current`                       | data  | Skip the current order when already right    |
|                    | `state`                                | order | Start / stop                                 |
|                    | `charge_current`                       | order | Set before a start                           |
| `electric_vehicle` | `battery_level`                        | data  | Target, minimum, rate                        |
|                    | `plugged`, `at_home`, `charging_state` | data  | Active car (FR1), done (`completed`)         |
|                    | `charge_limit`                         | data  | Effective target (FR3)                       |
|                    | `wake`                                 | order | FR11                                         |
|                    | `refresh`                              | order | FR10 (core spec 184; skipped when not bound) |

## Core APIs

| API                                              | Use                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `ctx.equipmentManager.getDataBindingsWithValues` | Snapshot of each equipment                                                        |
| `ctx.dispatchOrder(id, alias, value)`            | Orders; `{success:false, error}` is the charger's refusal (no throw)              |
| `ctx.eventBus.onType("equipment.data.changed")`  | Re-evaluate on charger / vehicle changes (edge-guarded)                           |
| `ctx.helpers.energy.claimCapacity`               | One claim on the charger; `reportNeed` every evaluation                           |
| `ctx.helpers.getTariff()`                        | Off-peak now (FR6a); re-read every evaluation                                     |
| `ctx.state`                                      | `summary`, `mode`, `active_vehicle`, `alert`, `owned`, `hold`, `rate.<vehicleId>` |
| `ctx.log`                                        | Decision changes                                                                  |

## Decision table (`decide`)

Evaluated top to bottom, first match wins:

| #   | Condition                                                                                     | Mode        | Charger            | Claim            |
| --- | --------------------------------------------------------------------------------------------- | ----------- | ------------------ | ---------------- |
| 1   | `vehicle` = disconnected                                                                      | `unplugged` | off if owned (FR4) | release          |
| 1b  | `vehicle` unknown (charger offline)                                                           | `offline`   | — (nothing)        | keep, need false |
| 2   | manual hold                                                                                   | `manual`    | — (left alone)     | need false       |
| 3   | battery known ≥ effective target, car `completed`, or the car refused two starts this plug-in | `done`      | stop if owned      | release          |
| 4   | battery known < `min_soc` and (off-peak now or now ≥ latest start)                            | `guarantee` | run                | keep, need true  |
| 5   | battery unknown or < effective target                                                         | `surplus`   | run iff granted    | keep, need true  |

`latest start = next departure − (min_soc − battery) / rate − 30 min`. The next departure is today's if not yet passed, else tomorrow's.

## Files

`src/index.ts`, `src/sowel-types.ts`, `src/decide.ts`, `src/inputs.ts`, `src/charger.ts`, `src/rate.ts`, `src/i18n.ts`, tests next to each; `manifest.json` (`type: "recipe"`, `sowelVersion` ≥ the release carrying spec 184).
