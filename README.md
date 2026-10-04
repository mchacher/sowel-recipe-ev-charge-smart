# Sowel recipe: ev-charge-smart

Smart EV charging for [Sowel](https://docs.sowel.org): one charger (core `ev_charger`), one or more cars (core `electric_vehicle`).

- Charges from the **solar surplus** through Sowel's energy arbiter, up to a target battery level (the car's own limit is honoured). On a core with modulating claims (spec 185) the charging current follows the surplus, 1 A at a time, between the charger's minimum and a maximum you set.
- Guarantees a **minimum battery level by a departure time**, from off-peak hours first.
- **Wakes a sleeping car** when the charger refuses to start, and refreshes the car's data after a start.
- Leaves a charge switched on by hand alone; switching the charger off by hand (or unplugging) hands it back to the recipe at once.

## Parameters

| Parameter               | Default | Meaning                                                                 |
| ----------------------- | ------- | ----------------------------------------------------------------------- |
| Charger                 | —       | The EV charger to drive                                                 |
| Vehicles                | —       | The cars that charge on it (optional; without one, no % target)         |
| Target (%)              | 80      | Surplus charging stops here, or at the car's own limit if lower         |
| Guaranteed minimum (%)  | 30      | Reached by the departure time from the grid, off-peak first; 0 disables |
| Departure               | 07:30   | When the minimum must be reached                                        |
| Charge current (A)      | 10      | The guaranteed minimum's current (and surplus charging on older cores)  |
| Max surplus current (A) | 16      | Upper bound when the current follows the surplus (core spec 185)        |

Surplus charging needs an energy profile on the charger (flexible load). Without one, the guaranteed minimum still works.

The recipe's state carries `summary` (tile), `mode`, `active_vehicle` and `alert` (notifiable: a car that did not wake, a minimum missed at departure).

## Development

```bash
npm install
npm run validate
```

Install on a Sowel instance through a personal source (core spec 136) until the recipe is in the registry.

## License

AGPL-3.0, like Sowel.
