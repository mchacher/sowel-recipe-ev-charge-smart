# Spec 005 — The guarantee takes the surplus when it is larger

- **Status**: Implemented
- **Date**: 2026-10-10
- **Related**: spec 002 (amends FR4 / FR4b, lifts its non-goal "changing the current in guarantee mode with the surplus"), spec 001 FR6

## Context

Owner's installation, 2026-10-10. The tariff has an afternoon off-peak slot (14:34–17:04). At 14:34 the car was at 29 % with a 30 % minimum: the recipe switched from surplus (charging at 9 A on a 2016 W budget) to guarantee and dropped the charger to `charge_current` = 6 A. The arbiter kept granting the claim with a budget of 1832–2290 W (8–10 A); that surplus was exported instead of charging the car.

Spec 002 FR4 keeps the guarantee at the fixed current whatever the budget. That is right when the budget is smaller (the guarantee must not depend on the sun), wrong when it is larger.

## Goals

1. In guarantee mode, charge at the larger of `charge_current` and the current the arbiter's budget allows.
2. Never charge below `charge_current` in guarantee mode (the guarantee stays independent of the surplus).

## Non-goals

- Changing when the guarantee starts or stops (spec 001 FR6).
- Learning the charge rate at currents other than `charge_current` (spec 002 FR4c unchanged).

## Functional requirements

- **FR1 — Guarantee current.** In guarantee mode, on a modulating claim that is granted with a known budget, the wanted current is `max(charge_current, budget current)`. Otherwise (no grant, no budget, binary claim, older core) it is `charge_current`, as before.
- **FR2 — Start.** A guarantee start uses the FR1 current.
- **FR3 — Follow.** While the recipe owns a charge in guarantee mode, a budget change, a grant or a revoke moves the current to the FR1 value (once per value, spec 002 FR4d). A revoke brings it back to `charge_current`; it never stops the guarantee (spec 001).
- **FR4 — Tile.** Unchanged: the current is shown in surplus mode only.

## Acceptance criteria

- [x] AC1 — Guarantee, granted, budget 3680 W at 230 V → 16 A.
- [x] AC2 — Guarantee, granted, budget 1380 W (6 A) with `charge_current` 10 → 10 A.
- [x] AC3 — Guarantee at the budget's current, then revoked → back to `charge_current`, still charging.
- [x] AC4 — A guarantee start while granted with a larger budget starts at the budget current.
- [ ] AC5 — Live: during an off-peak guarantee on a sunny afternoon, the current follows a budget above `charge_current` (owner's installation).

## Edge cases

| Case                                      | Expected                                           |
| ----------------------------------------- | -------------------------------------------------- |
| Older core (no `budgetW`) or binary claim | `charge_current`, spec 001 behaviour               |
| Budget known but claim not granted        | `charge_current` (a budget without grant is stale) |
| Guarantee charge above `charge_current`   | No rate learned meanwhile (spec 002 FR4c)          |
