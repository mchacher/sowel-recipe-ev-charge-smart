# Spec 007 — Plan

- [x] 1. `src/index.ts`: FR1, the give-up cleared when the car draws.
- [x] 2. `src/index.ts`: `adoptedAt`, `ADOPT_GRACE_MS`, `inAdoptGrace()`, the end-of-grace timer (FR2, FR3).
- [x] 3. Tests in `src/index.test.ts` (below).
- [x] 4. Spec 006 edge case row marked as amended; README if it describes adoption.
- [ ] 5. Version bump and changelog at release (`ev-release`).

## Test plan

All in `src/index.test.ts`, fake ctx, fake timers.

| Scenario                                                                               | Expected                                                                     |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Car full-refusing, two failed starts, then draws by itself, battery 44 %, day, pending | one "redemande" log, new claim, adopted, no `state` false during 6 min (AC1) |
| Same, grant at 4 min                                                                   | still drawing, no `state` order after the grant (AC2)                        |
| Same, no grant                                                                         | one `state` false at 7 min (AC3)                                             |
| Car draws by itself after the give-up, battery ≥ target                                | `done`, stopped after adoption (AC4)                                         |
| Plug-in auto-start, `isDaylight` false / null                                          | stopped right after adoption (AC5; spec 006 AC1 kept)                        |
| Plug-in auto-start, day, pending                                                       | kept 7 min, then stopped (AC6)                                               |
| Grace in progress, unplugged with the reading still drawing                            | mode `unplugged`, `state` false sent (AC7)                                   |
| Grace in progress, battery reaches the target                                          | stopped at once                                                              |
| Plug-in auto-start, `isDaylight` null / no `getSunlight`                               | stopped right after adoption (FR3)                                           |
| Grace, charger left at 16 A                                                            | `charge_current` 6 ordered (AC6b)                                            |
| Grace, the arbiter revokes                                                             | stopped                                                                      |
| Person's ON through Sowel after the give-up                                            | `manual`, no FR1 log                                                         |
