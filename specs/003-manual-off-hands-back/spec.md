# Spec 003 — A manual OFF hands the charger back

- **Status**: Implemented
- **Date**: 2026-10-04
- **Related**: spec 001 FR13 (manual hold — amended here)

## Context

Night of 2026-10-03 on the owner's installation: the owner switched the charger ON by hand, woke the car, then switched it OFF a few seconds later; later they edited the recipe and pressed "resume control" in the arbiter. The recipe stayed in manual hold all night (spec 001 FR13: "until the car is unplugged"), so the guaranteed minimum never ran during the off-peak hours, and the departure alert fired at 07:30 with the car at 20 %.

A person switching the charger OFF ends their manual run; it does not mean "never charge".

## Functional requirements

- **FR1** A person's ON order on the charger (manual, button, shared access, external — not the delivery-retry channel) puts the recipe in manual hold, as before.
- **FR2** A person's OFF order ends the hold at once: the recipe takes over in the same evaluation (the guarantee starts again right away; surplus charging follows once the arbiter accepts the claim — its own 2 h suspension after any manual order, or "resume control").
- **FR3** The arbiter's `manual-override` revoke is decided after the order handlers have run: when it answers a person's OFF (within 10 s), it does not put the recipe in hold.
- **FR4** Since a person's OFF ends the hold, a persisted hold means a charge switched on by hand and not off since: it survives an instance restart (core restart, or the recipe edited) while the car is still plugged, and is dropped if the car was unplugged meanwhile. A restart also holds when a charge it did not start is running.
- Unplugging still clears everything (spec 001 FR4).

## Acceptance criteria

- [x] AC1 — Manual ON → hold; manual OFF → the recipe acts at once (guarantee restarts the charge).
- [x] AC2 — Arbiter revoke then the person's OFF → never held, no "switched on by hand" log line.
- [x] AC3 — A persisted hold survives a restart while plugged, is dropped once unplugged.
- [x] AC4 — A person's ON on a charge the recipe owns: held, and no OFF is sent behind them (review).
