# Spec 005 — Plan

- [x] 1. `guaranteeAmps()` in `src/index.ts`, used for the start and the owned-charge current.
- [x] 2. Tests in `src/index.test.ts`; spec 002's FR4 test rewritten to the new rule.
- [x] 3. Spec 002 FR4 marked as amended by this spec.

## Test plan

| Scenario                                                  | Expected                             |
| --------------------------------------------------------- | ------------------------------------ |
| Guarantee, granted, budget 3680 W                         | current 16 A (AC1)                   |
| Guarantee, granted, budget 1380 W, `charge_current` 10    | current stays 10 A (AC2)             |
| Guarantee at 16 A on budget, then revoke                  | back to 10 A, charger still on (AC3) |
| Granted with budget 2990 W, off-peak starts the guarantee | starts at 13 A (AC4)                 |
| Guarantee, older core (no `budgetW`)                      | `charge_current`                     |
