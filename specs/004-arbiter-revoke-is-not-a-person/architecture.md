# Spec 004 — Architecture

`src/index.ts`: `onRevoked("manual-override")` only defers the evaluation (`queueMicrotask`); the hold decision and the `lastManualOffAt` window of spec 003 are removed. `onOrder` remains the only source of a hold.
