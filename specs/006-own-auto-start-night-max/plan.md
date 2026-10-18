# Spec 006 — Plan

- [ ] 1. `src/sowel-types.ts`: optional `getSunlight`; `src/testing/ctx.testing.ts`: settable fake.
- [ ] 2. `src/index.ts`: claim after the decision (FR5).
- [ ] 3. `src/index.ts`: adoption (FR1) and the restart rule (FR2).
- [ ] 4. `src/index.ts`: `nightOffPeak()` in `guaranteeAmps()` (FR3, FR4).
- [ ] 4b. `src/i18n.ts` and README: FR6 labels.
- [ ] 5. Tests in `src/index.test.ts`; the "restart … without, a running charge is manual" test rewritten.
- [ ] 6. Spec 001 FR13 marked as amended; README if it describes the restart rule.
- [ ] 7. Version bump and changelog at release (`ev-release`).

## Test plan

All in `src/index.test.ts`, fake ctx, fake timers.

| Scenario                                                                | Expected                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| Plug-in, charger draws by itself, surplus mode, not granted             | adopted, `state` false ordered, one log line (AC1)  |
| Charger draws by itself, battery ≥ target                               | adopted, stopped, mode `done` (AC2)                 |
| Charger draws by itself, battery < min, off-peak, night                 | adopted, kept, `charge_current` → 16 (AC3)          |
| Person's ON (manual source), surplus, not granted                       | hold, not stopped (AC4)                             |
| Restart, no `owned`, no `hold`, drawing, not granted                    | adopted and stopped (AC5)                           |
| Restart with persisted hold, plugged                                    | still held (spec 003 unchanged)                     |
| Person's ON whose `state` reading precedes the order event (10 s later) | held, no `state` false sent (AC12)                  |
| Drawing for 20 s then stops, no order                                   | nothing adopted, no order                           |
| Recipe's own stop, reading still `true` within the quiet window         | not re-adopted, no second stop                      |
| Guarantee start, off-peak, `isDaylight` false, `max_current` 16         | starts at 16 A (AC6)                                |
| Guarantee, off-peak, `isDaylight` true                                  | spec 005 current (AC7)                              |
| Guarantee forced in peak hours (past latest start), night               | `charge_current` (AC8)                              |
| Guarantee, off-peak, `isDaylight` null / no `getSunlight`               | spec 005 current (AC9)                              |
| Owned guarantee at 16 A at night, off-peak ends, next tick              | back to `charge_current`, still on (AC10)           |
| Slot labels, en and fr                                                  | FR6 names (AC13)                                    |
| Mode `done`, ten ticks                                                  | no `claimCapacity` call (AC11)                      |
| Synchronous grant at claim time, surplus                                | started in the same evaluation (existing test kept) |
