# Spec 007 — A car that asks again is charged again

- **Status**: Implemented
- **Date**: 2026-11-21
- **Related**: spec 001 (FR10–FR12, the give-up until unplug), spec 006 (FR1 adoption; amends its edge case "car refused twice, then the charger draws again → adopted, then stopped by `done`"), core spec 140 (arbiter, `engageHoldS`)

## Context

Owner's installation, 2026-11-21, Megane E-Tech plugged on the dé at 09:44 local, battery 44 %, target 90 %.

- 09:45 — the dé starts by itself on plug-in; the recipe adopts the charge 30 s later and stops it (surplus mode, no grant yet). The Megane goes to sleep.
- 11:06 — the arbiter grants 1 344 W. The charger refuses the start: "the vehicle is not asking for current". Two wakes (lights) do nothing: on the Megane they do not wake the charge (see the Renault plugin findings). Backoff 15 min.
- 11:25 — same again; second failed start sequence → `gaveUp`, mode `done`, claim released, "plus d'essai jusqu'au débranchement".
- 12:23 — the Megane starts drawing by itself. The recipe adopts it after 30 s and, still in `done`, stops it at once. About 1.1 kW of surplus was exported at the time.

The same sequence happened on 2026-11-14 with the Megane.

Two faults:

1. **The give-up outlives its reason.** `gaveUp` means "the car does not want current". A car that draws by itself contradicts it, but the recipe keeps it until unplug and stops the charge the car asked for.
2. **An adopted charge is stopped before the arbiter can grant it.** The arbiter grants a pending claim only after the surplus has held for `engageHoldS` (300 s on the owner's instance), counting the load's own draw. The recipe stops an adopted surplus charge 30 s after it appears, so it never reaches the grant. On a car that does not resume after a pause (the Megane), that stop loses the charge for the session.

## Goals

1. A car that draws by itself after the recipe gave up clears the give-up: the session starts over.
2. By day, an adopted surplus charge is given the time the arbiter needs to grant it before being stopped.

## Non-goals

- A different wake path for the Megane (no remote route is known, see the Renault plugin findings).
- Changing the arbiter's `engageHoldS` or granting a running load at once (a core matter).
- Night behaviour: an adopted charge without surplus at night is still stopped at once (spec 006 AC1).

## Functional requirements

- **FR1 — The car asks again.** On an evaluation where the recipe has given up (`gaveUp`), the car is plugged, the charger is drawing (`state` true), no manual hold is active and the quiet window after the recipe's own `state` order is over, the give-up is cleared (failures, backoff and give-up reset, as on a new plug-in) and the recipe logs once `La voiture redemande du courant : la recette reprend la main`. The decision then leaves `done` (unless the battery or the car says otherwise), the claim is opened again, and the charge is adopted after `ADOPT_DELAY_MS` (spec 006 FR1).
- **FR2 — Grace for an adopted charge by day.** When the recipe adopts a charge (spec 006 FR1, or the FR1 path above), it records the adoption time. While all of these hold, a `stop` decision in `surplus` mode is not applied:
  - the charge is owned and drawing;
  - the claim is pending (not granted, not denied, not released);
  - the core says it is day (`getSunlight().isDaylight === true`);
  - less than `ADOPT_GRACE_MS` (7 min) has passed since the adoption.

  During the grace the charge runs at the charger's minimum current (the claim's range minimum, else `charge_current`): it may be drawing from the grid until the arbiter decides. At the end of the grace the recipe evaluates again: granted, the charge goes on; otherwise it is stopped as today. The grace ends at once on a grant, a revoke, an unplug, a manual hold, or any decision other than `surplus` (`done` and `guarantee` apply as before).

- **FR3 — Unknown daylight is not day.** `isDaylight` null or an older core without `getSunlight`: no grace (spec 006 behaviour).

## Acceptance criteria

- [x] AC1 — Two failed starts (`done`, "la voiture ne demande plus"), then the car draws by itself, battery below the target, by day, not granted → give-up cleared, one log line, claim opened, charge adopted and not stopped during the grace.
- [x] AC2 — Same, and the arbiter grants within the grace → the charge goes on, no `state` order sent.
- [x] AC3 — Same, no grant within the grace → stopped once, at the end of the grace.
- [x] AC4 — Car draws by itself after the give-up, battery at or above the target → `done`, stopped (FR1 does not override the target).
- [x] AC5 — Adoption by night (`isDaylight` false) or unknown daylight, no surplus → stopped right after adoption (spec 006 AC1 unchanged).
- [x] AC6 — Adoption by day on plug-in, not granted → kept during the grace, then stopped without a grant.
- [x] AC6b — A grace in progress, the charger was left at a higher current (e.g. 16 A from a night off-peak guarantee) → the current is set to the minimum.
- [x] AC7 — A grace in progress, the car is unplugged → mode `unplugged`, the grace ends, the charger is switched off as on any unplug (spec 001).
- [ ] AC8 — Live: on the owner's installation, a Megane that resumes by itself after a give-up keeps charging on the surplus.

## Edge cases

| Case                                                              | Expected                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The car draws for less than 30 s after the give-up                | Give-up cleared (FR1), nothing adopted; a later grant starts it                                                                  |
| Claim denied at reopening (e.g. not profiled)                     | No grace (claim not pending): stopped as today                                                                                   |
| Grace in progress, the surplus disappears                         | Charge kept until the end of the grace, then stopped: at most ~0.16 kWh from the grid at the 6 A minimum                         |
| Grace in progress, the battery reaches the target                 | `done` applies at once: stopped                                                                                                  |
| Grace in progress, a person switches the charger off              | Spec 003: hand back, the grace ends                                                                                              |
| The give-up raised an alert (guarantee)                           | The alert stays until the next successful start (as today)                                                                       |
| The recipe's own stop, reading still true within the quiet window | Not adopted, no grace (spec 006 unchanged)                                                                                       |
| A car that stops and resumes by itself again and again            | Each self-start is adopted with a new grace: the grid draw is bounded by how often the car does it, not by the recipe (accepted) |
| A person switches the charger on through Sowel after a give-up    | Manual hold (spec 003); the give-up is not cleared, no FR1 log                                                                   |
| Grace in progress, the arbiter revokes                            | The grace ends: stopped                                                                                                          |
