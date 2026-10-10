# Changelog

All notable changes to this recipe. Versions follow semver; the registry in `mchacher/sowel` carries the SHA256 of each released tarball.

## v0.1.3

- **The guaranteed minimum takes the surplus when it is larger** (spec 005). During the guarantee (for instance in an afternoon off-peak slot) the charger used to stay at `charge_current` even when the sun offered more; the surplus was exported. It now charges at the larger of `charge_current` and the current the surplus allows, and never below `charge_current`.

## v0.1.2

- **The arbiter taking the charger back is not a person** (spec 004). A `manual-override` revoke from the arbiter no longer puts the recipe in manual mode; only your ON order does. With a sleeping car, the arbiter used to read the charger as switched off at a wall switch, and the recipe then stood back for no reason.

## v0.1.1

- **A manual OFF hands the charger back** (spec 003). Switching the charger off by hand used to keep the recipe out until the car was unplugged — a night with the guaranteed minimum skipped. Now only a manual ON makes it stand back; a manual OFF lets it act at once, and editing the recipe no longer inherits a past hold.

## v0.1.0

First release. **Smart EV charging**: one charger (core `ev_charger`), one or more cars (core `electric_vehicle`) — specs 001 and 002, checked live on a dé charger and a Renault Rafale.

- **Solar surplus** through Sowel's energy arbiter, up to a target battery level (the car's own limit honoured). On a core with modulating claims (spec 185), the charging current follows the surplus, 1 A at a time, up to `max_current`.
- **Guaranteed minimum** by a departure time, from the grid: off-peak hours first, else the latest start computed from a learned charge rate.
- **Wakes a sleeping car** when the charger refuses to start, and refreshes the car's data after a start. A car that refuses twice (full at its own limit) is left alone until it is unplugged.
- **Never fights you**: a charge switched by hand is left alone until the car is unplugged.
- **Tile**: mode, battery, target and current; notifiable `alert` when the minimum is at risk.
