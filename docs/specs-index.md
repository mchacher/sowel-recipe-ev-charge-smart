# Specs index — sowel-recipe-ev-charge-smart

Every feature ever specified in this repository, one row each, newest last. A
CI check (`scripts/check-specs-index.sh`) fails a pull request that creates a
`specs/NNN-name/` folder without its row here.

Status: 📝 Draft · 🚧 In progress · ✅ Shipped

| #   | Title                                                      | Status | Summary                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | Smart EV charging: solar surplus, guaranteed minimum, wake | 📝     | One charger, one or more cars: surplus charging through the arbiter (binary claim at a fixed current) up to a target %, the car's own limit honoured; a minimum % guaranteed by a departure time from the grid (off-peak first, then the latest start from a learned %/h); `wake` and retry when the charger refuses a sleeping car; `refresh` after a start; manual hold until unplug. |
| 002 | Charge current that follows the surplus                    | 📝     | Core spec 185: the claim declares the charger's current range (order minimum to `max_current`, 1 A steps at the measured voltage); each budget sets the charging current while the recipe owns a surplus charge. The guaranteed minimum keeps its fixed current; a core without spec 185 gets spec 001's binary claim.                                                                  |
| 003 | A manual OFF hands the charger back                        | ✅     | Amends spec 001 FR13: only a person's ON order holds; a person's OFF hands the charger back at once (the arbiter's manual-override revoke for that OFF does not hold); a persisted hold survives a restart only while the car stays plugged. Found on the owner's installation, night of 2026-10-03.                                                                                    |
