# Spec 002 — Architecture

| File                     | Change                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sowel-types.ts`         | `CapacityClaimRequest.modulation?`, `onBudget?`; handle `budgetW?()`; order binding `min`/`max`                                        |
| `inputs.ts`              | `ChargerView.currentMin/currentMax` from the `charge_current` order binding                                                            |
| `current.ts` (new, pure) | `rangeOf(view, maxA)` → `{minA, maxA, V, modulation}`; `ampsFor(budgetW, range)`                                                       |
| `charger.ts`             | `setCurrent(amps)` (never throws, no recipe-log line)                                                                                  |
| `index.ts`               | claim with `modulation` + `onBudget`; budget amps remembered; applied while owning a surplus charge; start current by mode; tile power |
| `i18n.ts`                | `max_current` slot                                                                                                                     |
