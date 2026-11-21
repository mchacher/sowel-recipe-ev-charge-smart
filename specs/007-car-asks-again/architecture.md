# Spec 007 — Architecture

`decide()` is unchanged. The changes are at the edges, in `src/index.ts`.

## FR1 — The car asks again

In `evaluateOnce()`, right after reading the charger and before the decision:

```ts
if (
  this.control.gaveUp &&
  charger.state === true &&
  charger.vehicle !== null &&
  charger.vehicle !== "disconnected"
) {
  this.control.resetSession();
  this.ctx.log("La voiture redemande du courant : la recette reprend la main");
}
```

`resetSession()` already exists (`src/charger.ts`) and is what an unplug does. The decision of the same evaluation sees `refusedUntilUnplug: false`, keeps the claim and opens it.

## FR2 — Grace for an adopted charge by day

A new field `adoptedAt: number | null`, set in `adoptUnexplained()` when it takes ownership, cleared when ownership ends (stop, unplug, hold) and on a grant or revoke.

```ts
export const ADOPT_GRACE_MS = 7 * 60_000;

private inAdoptGrace(d: Decision, drawing: boolean): boolean {
  return (
    this.adoptedAt !== null &&
    d.mode === "surplus" &&
    this.control.owned &&
    drawing &&
    this.claim?.status() === "pending" &&
    this.ctx.helpers.getSunlight?.().isDaylight === true &&
    Date.now() - this.adoptedAt < ADOPT_GRACE_MS
  );
}
```

The charger section's stop branch becomes:

```ts
} else if (d.charger === "stop" && this.control.owned && !this.control.starting) {
  if (!this.inAdoptGrace(d, drawing)) this.after(this.control.stop(MODE_LABEL[d.mode]));
}
```

On adoption, a timer evaluates again at `ADOPT_GRACE_MS + 1 s`, so the end of the grace does not wait for the next minute tick.

`adoptedAt` is not persisted: after a restart the charge is owned (`owned` persisted) without a grace, and the decision applies at once. A restart during the 7 minutes is rare and only loses the grace.

7 min covers the owner's `engageHoldS` (300 s) plus the arbiter's pass period and the 30 s adoption delay. The recipe cannot read `engageHoldS`; the value is a constant, documented here.

## Contracts and core APIs

No new API: `claim.status()` (core spec 140), `getSunlight()` (core spec 126, already optional in `src/sowel-types.ts`).

## Files

| File                                         | Change                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| `src/index.ts`                               | FR1 reset, `adoptedAt`, `ADOPT_GRACE_MS`, grace in stop |
| `src/index.test.ts`                          | AC1–AC7                                                 |
| `specs/006-own-auto-start-night-max/spec.md` | Edge case row marked as amended by spec 007             |
| `docs/specs-index.md`                        | Row 007                                                 |
| `README.md`                                  | One sentence on the grace, if it describes adoption     |
