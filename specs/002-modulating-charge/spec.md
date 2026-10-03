# Spec 002 — Charge current that follows the surplus

- **Status**: Draft
- **Date**: 2026-10-04
- **Related**: core spec 185 (modulating capacity claim), spec 001 (this recipe), core spec 182 (`charge_current` order with its bounds)

## Context

Spec 001 claims the surplus at one fixed current (`charge_current`, default 10 A ≈ 2.3 kW): the charge only starts when 2.3 kW of surplus has held, and with more surplus the rest is exported. Core spec 185 lets a claim declare a range and receive a budget that follows the surplus. The dé charger accepts any whole amp from 6 to 16 A.

## Goals

1. In surplus mode, charge at the current the arbiter's budget allows, between the charger's minimum and a configurable maximum.
2. Keep the guaranteed minimum (spec 001 FR6) at the fixed `charge_current`.
3. Keep working, unchanged, on a core without spec 185 (binary claim at `charge_current`).

## Non-goals

- Changing the current in guarantee mode with the surplus (a later option).
- Three-phase chargers.

## Functional requirements

- **FR1 — Range.** The claim carries `modulation: { minW: minA·V, maxW: maxA·V, stepW: V }`, where `V` is the charger's measured voltage (else 230 V), `minA` the `charge_current` order's minimum (else 6), `maxA` = min(the order's maximum (else 16), the new `max_current` slot). `watts` stays `charge_current·V` for cores that ignore `modulation`. An invalid range (max < min) falls back to a binary claim.
- **FR2 — Budget → current.** On `onBudget(w)`: `amps = clamp(floor(w / V), minA, maxA)`. While the recipe owns a surplus charge, the charger's current is set to it when it differs (no log line per change — FR15 of spec 001: debug only).
- **FR3 — Start.** A surplus start uses the budget current (else `minA`); a guarantee start uses `charge_current`, as in spec 001.
- **FR4 — Guarantee keeps its current.** In guarantee mode a budget change does not touch the current.
- **FR4b — Guarantee current.** An owned charge in guarantee mode is set to `charge_current` if it runs at another current (a surplus charge turning into a guarantee). The claim stays open and modulating meanwhile, so the core may journal `watts-divergence` / `budget-not-honored` and count the excess over the budget as background: that is what grid charging is, and it keeps the arbiter's books right.
- **FR4c — Learned rate.** The charge rate (spec 001 FR8) is learned only while the charger runs at `charge_current`: it times the guarantee, which runs at that current.
- **FR4d — One order per value.** A current is ordered once per value; it is sent again only when the wanted current changes (the dé confirms in 1–8 s while readings arrive every few seconds). Current orders do not extend the start window (spec 001 FR11b).
- **FR5 — New slot.** `max_current` (A, 6–32, default 16): the upper bound in surplus mode.
- **FR6 — Tile.** In surplus mode the summary adds the current, e.g. "☀ Surplus · 45 % → 80 % · 13 A" (the setpoint changes only with the budget; a measured power would rewrite the tile on every reading).

## Acceptance criteria

- [x] AC1 — Budget 2990 W at 230 V → current 13 A; 1380 → 6 A; 5000 → max.
- [x] AC2 — A budget change while charging on surplus sets `charge_current`; in guarantee mode it does not.
- [x] AC3 — A surplus start uses the budget current.
- [x] AC4 — With no `budgetW` on the handle (older core), behaviour is spec 001's.
- [ ] AC5 — Live: the current follows the surplus on a sunny day (owner's installation).

## Edge cases

| Case                                  | Expected                                           |
| ------------------------------------- | -------------------------------------------------- |
| `charge_current` order refused        | Logged at debug; retried on the next budget change |
| Budget arrives before the charge owns | Remembered; used by the next surplus start         |
| `max_current` below the order minimum | Binary claim at `charge_current` (FR1 fallback)    |
