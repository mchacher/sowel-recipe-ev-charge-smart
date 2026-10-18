# Spec 006 — Architecture

`decide()` is unchanged: modes and run/stop decisions do not move. The changes are at the edges, in `src/index.ts`.

## FR1 / FR2 — Adoption

In `evaluateOnce()`, before the charger section:

```ts
const adoptable =
  drawing &&
  !this.control.owned &&
  !this.hold &&
  !this.control.starting &&
  charger.vehicle !== null &&
  charger.vehicle !== "disconnected" &&
  Date.now() > this.quietUntil;
if (!adoptable) this.unownedSince = null;
else if (this.unownedSince === null) {
  this.unownedSince = Date.now();
  this.later(ADOPT_DELAY_MS, () => this.evaluate());
} else if (Date.now() - this.unownedSince >= ADOPT_DELAY_MS) {
  this.unownedSince = null;
  this.control.owned = true;
  this.setOwned(true);
  this.ctx.log("Charge démarrée par la borne : la recette la prend en main");
}
```

`ADOPT_DELAY_MS` = 30 s: a person's ON through Sowel shows on the `state` reading before `equipment.order.executed` (emitted after the plugin's verified write), and that order's hold must win. The existing "drawing on a run decision: adopt it" branch stays: a charge the decision wants is the recipe's at once.

Constructor: the `else if (charger.state === true && …) this.setHold(true)` branch is removed; the first evaluation adopts the charge (FR2).

## FR3 / FR4 — Night off-peak current

`guaranteeAmps()` gains a first case:

```ts
if (this.nightOffPeak()) return Math.max(this.p.current, this.range?.maxA ?? this.p.maxCurrent);
```

`nightOffPeak()` = `getTariff?.().isOffPeakNow === true && getSunlight?.().isDaylight === false`. `getSunlight` is added to the mirrored `helpers` in `src/sowel-types.ts` (optional, core spec 126). FR4 needs no wiring: the 60 s tick re-evaluates, and `desired` already follows `guaranteeAmps()`.

| Mode      | Night off-peak | Granted + budget | Current                             |
| --------- | -------------- | ---------------- | ----------------------------------- |
| guarantee | yes            | any              | max(`charge_current`, range max)    |
| guarantee | no             | yes              | max(`charge_current`, budget) (005) |
| guarantee | no             | no               | `charge_current`                    |
| surplus   | any            | yes              | budget current (002)                |

## FR5 — Claim after the decision

`evaluateOnce()` computes the decision first; `ensureClaim()` is called only when `d.claim === "keep"` (and the existing conditions: plugged, online, not given up). If `this.granted` changed during `ensureClaim()` (synchronous grant), the decision is recomputed before acting. The decision inputs are built by one local function so both calls see the same snapshot.

## FR6 — Labels

`src/i18n.ts`: `name` and `description` of `charge_current` and `max_current`, English slots and the French pack; README parameter table.

## Files

| File                         | Change                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| `src/index.ts`               | adoption, constructor restart rule, `nightOffPeak()`, claim order |
| `src/i18n.ts`, `README.md`   | FR6 labels                                                        |
| `src/sowel-types.ts`         | optional `getSunlight` helper                                     |
| `src/testing/ctx.testing.ts` | fake `getSunlight` (settable `isDaylight`)                        |
| `src/index.test.ts`          | test plan below; the restart test rewritten to FR2                |
| `specs/001-…/spec.md`        | FR13 marked as amended by spec 006 (restart rule)                 |
| `docs/specs-index.md`        | row 006                                                           |
