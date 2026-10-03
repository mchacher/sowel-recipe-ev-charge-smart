# Spec 001 — Plan

## Steps

- [ ] 1. Core spec 184 (`refresh`) merged and released; Renault plugin publishes `refresh`.
- [x] 2. `decide.ts`, `rate.ts` (pure) + tests.
- [x] 3. `inputs.ts`, `charger.ts` + tests with a fake ctx.
- [x] 4. `index.ts` (lifecycle, claim, tick, events, tile, i18n) + tests with fake timers.
- [x] 5. Manifest, README, changelog.
- [ ] 6. Candidate instance: charger profile set, recipe installed from a personal source; surplus simulated by the arbiter state; a real wake from sleep with the owner's agreement.

## Test plan

| Module  | Scenario                                                                                       | Expected                                    |
| ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| decide  | Charger disconnected                                                                           | `unplugged`, release                        |
| decide  | Battery 85, target 80                                                                          | `done`, stop if owned, release              |
| decide  | Battery 75, target 80, car limit 70                                                            | `done` (effective target 70)                |
| decide  | Car `completed` at 60                                                                          | `done`                                      |
| decide  | Battery 20, min 30, off-peak now                                                               | `guarantee`, run                            |
| decide  | Battery 20, min 30, no tariff, 02:00, rate 10 %/h, departure 07:30                             | latest start 06:00 → not yet: `surplus`     |
| decide  | Same at 06:05                                                                                  | `guarantee`                                 |
| decide  | After departure                                                                                | next day's departure used                   |
| decide  | Battery unknown                                                                                | `surplus`, never `guarantee`                |
| decide  | Manual hold                                                                                    | `manual`, charger untouched                 |
| decide  | min_soc 0                                                                                      | never `guarantee`                           |
| inputs  | One of two cars plugged / both plugged one charging / both idle / none plugged, one configured | active car per FR1                          |
| inputs  | Car not at home                                                                                | not a candidate                             |
| rate    | Two readings 40 min apart, +7 %                                                                | rate moves toward 10.5 %/h                  |
| rate    | Readings 10 min apart                                                                          | ignored                                     |
| charger | Start: current differs → `charge_current` then `state` on                                      | two orders, in that order                   |
| charger | Start succeeds                                                                                 | `refresh` to the car 60 s later             |
| charger | `state` on fails, then succeeds after `wake`                                                   | `wake` sent, retry after 30 s, owned        |
| charger | Fails after two wakes                                                                          | back-off 15 min, `alert` set                |
| charger | Stop when not owned                                                                            | no order                                    |
| index   | Granted → start; revoked → stop                                                                | orders follow the callbacks                 |
| index   | Revoked in `guarantee`                                                                         | charge continues                            |
| index   | Charger state changed by someone else                                                          | manual hold until disconnected              |
| index   | Claim denied `not-profiled`                                                                    | logged once, guarantee still runs           |
| index   | Departure reached below minimum                                                                | `alert` set, warning logged once            |
| index   | Restart with `owned` and the charger charging                                                  | ownership kept                              |
| index   | Logs                                                                                           | one line per decision change, none per tick |
