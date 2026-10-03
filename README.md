# Sowel recipe: ev-charge-smart

Smart EV charging for [Sowel](https://docs.sowel.org): one charger (core `ev_charger`), one or more cars (core `electric_vehicle`).

- Charges from the **solar surplus** through Sowel's energy arbiter, up to a target battery level (the car's own limit is honoured).
- Guarantees a **minimum battery level by a departure time**, from off-peak hours first.
- **Wakes a sleeping car** when the charger refuses to start, and refreshes the car's data after a start.
- Leaves a charge switched by hand alone until the car is unplugged.

## Status

Specified (spec 001), not implemented yet.

## Development

```bash
npm install
npm run validate
```

Install on a Sowel instance through a personal source (core spec 136) until the recipe is in the registry.

## License

AGPL-3.0, like Sowel.
