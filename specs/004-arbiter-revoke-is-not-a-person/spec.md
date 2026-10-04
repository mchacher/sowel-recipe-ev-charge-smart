# Spec 004 — An arbiter revoke is not a person

- **Status**: Implemented
- **Date**: 2026-10-04
- **Related**: spec 003 (manual OFF hands back), spec 001 FR13; core fix "an EV charger reading off is the car, not a wall switch"

## Context

Owner's installation, 2026-10-04 11:20: the recipe started the charger on a grant; the car was asleep and drew nothing; the arbiter read the charger's "off" reading as a wall-switch OFF, suspended it and revoked the claim with `manual-override`. The recipe took that revoke for a person and held itself in manual mode.

## Functional requirements

- **FR1** A `manual-override` revoke never puts the recipe in manual hold. Only a person's ON order on the charger does (spec 003); a person's OFF hands it back.
- **FR2** After a `manual-override` revoke the recipe evaluates once the order handlers of the same event have run, so it never stops a charge a person has just switched on.

## Acceptance criteria

- [x] AC1 — Revoke alone: no hold.
- [x] AC2 — Revoke then a person's ON on an owned charge: held, no OFF sent.
