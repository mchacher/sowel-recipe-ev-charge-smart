# Spec 003 — Architecture

`src/index.ts` only:

- `onOrder`: the order's `value` decides — OFF (`false`, `0`, `"OFF"`, `"off"`) clears the hold and records `lastManualOffAt`; anything else holds.
- `onRevoked("manual-override")`: deferred with `queueMicrotask` — the event bus is synchronous and the arbiter subscribed first, so the recipe's own order handler has run by then; holds only if no person's OFF was seen in the last 10 s.
- `onRevoked("manual-override")` does not evaluate synchronously (it would stop the charge a person just switched on).
- Constructor: a persisted `hold` is kept while the charger reads a vehicle connected; the "charger drawing, not owned → hold" rule still applies.
