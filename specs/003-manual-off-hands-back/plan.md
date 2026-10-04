# Spec 003 — Plan

- [x] 1. `onOrder` / `onRevoked` / constructor changes.
- [x] 2. Tests, spec 001 FR13 amended, README.

## Test plan

| Scenario                                                                                                        | Expected                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Manual ON then OFF in guarantee mode                                                                            | hold, then released; charge restarted       |
| Arbiter `manual-override` revoke, then the person's OFF                                                         | never held; no "allumée à la main" log line |
| Restart with `hold` persisted, charger idle                                                                     | no hold                                     |
| Existing: manual ON holds until OFF/unplug; offline keeps the hold; restart with a charge running by hand holds | unchanged                                   |
