# Spec 005 — Architecture

`decide()` is unchanged: the mode and the run/stop decision do not move. Only the current chosen at the edge changes.

`src/index.ts`:

- New private `guaranteeAmps()`: `this.granted && this.modulating() && this.budgetAmps !== null ? Math.max(this.p.current, this.budgetAmps) : this.p.current`.
- The start current (`control.start({ current })`) and the `desired` current of an owned charge use `guaranteeAmps()` in guarantee mode instead of `this.p.current`.
- `onBudget`, `onGranted` and `onRevoked` already call `evaluate()`, so FR3 needs no new wiring.

| Mode      | Granted + budget | Current                       |
| --------- | ---------------- | ----------------------------- |
| surplus   | yes              | budget current (spec 002)     |
| guarantee | yes              | max(`charge_current`, budget) |
| guarantee | no               | `charge_current`              |
