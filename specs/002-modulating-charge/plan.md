# Spec 002 — Plan

## Steps

- [ ] 1. Types, `current.ts` + tests.
- [ ] 2. Inputs (order bounds), `ChargerControl.setCurrent` + tests.
- [ ] 3. Instance wiring (claim, onBudget, start current, guarantee unchanged, tile) + tests.
- [ ] 4. Validate, agent review, PR.

## Test plan

| Module  | Scenario                               | Expected                                     |
| ------- | -------------------------------------- | -------------------------------------------- |
| current | 2990 W / 230 V; 1380; 5000; NaN        | 13 A; 6 A; max; min                          |
| current | Order bounds 6–16, max_current 32 / 10 | range 6–16 / 6–10                            |
| current | max_current below the minimum          | no modulation (binary fallback)              |
| inputs  | `charge_current` order with min/max    | read into the view                           |
| charger | `setCurrent` refused / thrown          | false, no throw                              |
| index   | Claim carries modulation and watts     | both present                                 |
| index   | onBudget while owning a surplus charge | `charge_current` set to the new amps         |
| index   | onBudget in guarantee mode             | no current order                             |
| index   | Surplus start after a budget           | starts at the budget amps                    |
| index   | Handle without `budgetW` (older core)  | spec 001 behaviour, current = charge_current |
| index   | Tile in surplus                        | shows the power                              |
