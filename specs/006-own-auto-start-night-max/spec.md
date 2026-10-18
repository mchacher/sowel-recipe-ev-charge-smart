# Spec 006 — The recipe owns the charger's own starts; night off-peak at max current

- **Status**: Draft
- **Date**: 2026-10-18
- **Related**: spec 001 (amends FR13's restart rule and the "a charge the recipe did not start is left alone" behaviour), spec 005 (guarantee current), core spec 126 (`getSunlight`), core spec 138 (`getTariff`), core spec 140 (arbiter journal); `sowel-plugin-tuya` spec 001 "Hardware findings" (auto-start on plug-in)

## Context

Owner's installation, night of 2026-10-17 → 18. The car was plugged in at 19:14 local. The dé starts charging by itself when the cable goes in (plug-in action left at its default, recorded in the tuya plugin's spec 001). The recipe went to `surplus`, decided `stop` (no surplus in the evening), but `stop()` only acts on a charge the recipe owns, and nothing made this one its own: no start of its own, and no person's order (which would have meant a manual hold). The charge ran unmanaged at 6 A all night, in peak hours until 00:04, through `done` at 80 % at 05:07, and was still running at 95 % at 08:00 (the car's own limit is 100 %). 16.5 kWh.

Two more findings from the same investigation:

- **The off-peak guarantee runs at `charge_current` (6 A on the owner's instance).** At night there is no surplus, so spec 005's `max(charge_current, budget)` is always `charge_current`. A second car (a Megane E-Tech, larger battery) is coming: reaching the minimum overnight at 6 A will not always fit. The owner wants the night off-peak guarantee at `max_current`; elsewhere (afternoon off-peak, a peak-hour guarantee forced by the departure time) the current is unchanged.
- **Claim churn in `done`.** `ensureClaim` runs before the decision on every evaluation, and `done` releases the claim at once: the arbiter's journal got a `waiting` / `released` pair every few seconds all morning, flooding its 200-entry ring.

## Goals

1. A charge the recipe sees drawing, that it did not start and that no person switched on through Sowel, is the recipe's own: it is stopped or kept by the decision like any other.
2. The guarantee runs at `max_current` during an off-peak slot at night.
3. No claim is opened on an evaluation that releases it.

## Non-goals

- Writing the charger's plug-in action (`plugInAction` = `idle`): unverified on this firmware (DP 154 is not reported), and FR1 makes it unnecessary.
- Telling a person's action on the charger's own buttons or in the vendor app from the charger's auto-start: neither sends a Sowel order. Both are now adopted (accepted by the owner, 2026-10-18).
- Learning the charge rate at currents other than `charge_current` (spec 002 FR4c unchanged): `latestStart` still times a peak-hour guarantee at `charge_current`.
- Changing the claim's declared `watts`.

## Functional requirements

- **FR1 — Adopt an unexplained charge.** On every evaluation, when the charger is drawing (`state` true), the car is plugged, the recipe does not own the charge, no manual hold is active, no start of the recipe's is in progress and the quiet window after the recipe's own start/stop order is over, **continuously for 30 s** (`ADOPT_DELAY_MS`): the recipe takes ownership (`owned = true`, persisted) and logs once `Charge démarrée par la borne : la recette la prend en main`. The decision then applies as for any owned charge (stopped in `surplus` without a grant, in `done`; kept in `guarantee`; current set per spec 002/005 and FR3). The delay exists because a person's ON through Sowel reaches the recipe after its effect: the core emits `equipment.order.executed` once the plugin has verified the charge (tuya spec 001 FR-16), so the `state` reading comes first. A person's order arriving within the delay holds as before (spec 003), and nothing is stopped.
- **FR2 — Restart.** On a restart with no ownership record and no persisted hold, a running charge is adopted (FR1) instead of becoming a manual hold. A persisted hold still survives while the car stays plugged (spec 003).
- **FR3 — Night off-peak current.** In `guarantee` mode, when the tariff says off-peak now (`getTariff().isOffPeakNow === true`) **and** the core says it is night (`getSunlight().isDaylight === false`), the wanted current is `max_current` bounded by the charger's range (`rangeOf(...).maxA`). Otherwise it is spec 005's `max(charge_current, budget)`. An unknown daylight (`null`, no home coordinates, or an older core without `getSunlight`) is not night.
- **FR4 — Follow.** An owned guarantee charge moves to the FR3 current when night off-peak begins or ends (once per value, spec 002 FR4d), driven by the regular tick.
- **FR5 — No claim on a release.** The claim is only opened on an evaluation whose decision keeps it. A grant arriving synchronously at claim time is decided on in the same evaluation, before any charger action (as today).
- **FR6 — Labels.** `charge_current` is shown as "Guaranteed minimum current (A)" / "Courant du minimum garanti (A)": the guarantee charges at least at this current, more when the surplus allows, at the maximum at night off-peak. `max_current` is shown as "Maximum current (A)" / "Courant maximal (A)": the highest current asked of the charger, on surplus and at night off-peak. Slot ids and stored values are unchanged.

## Acceptance criteria

- [ ] AC1 — Car plugged in, the charger starts by itself in the evening, no surplus → the recipe adopts the charge and stops it; one adoption log line.
- [ ] AC2 — The charger starts by itself, battery at or above the target → adopted, stopped, `done`.
- [ ] AC3 — The charger starts by itself, battery below the minimum, night off-peak → adopted, kept, current moved to `max_current`.
- [ ] AC4 — A person's ON through Sowel still holds; the charge is not adopted nor stopped.
- [ ] AC5 — Restart without ownership nor hold, charge running, no surplus → adopted and stopped (no longer manual).
- [ ] AC6 — Guarantee, off-peak, `isDaylight` false → starts at `max_current` (16 A with `max_current` 16, charger max 16).
- [ ] AC7 — Guarantee, off-peak, `isDaylight` true (afternoon slot) → spec 005 current.
- [ ] AC8 — Guarantee, peak hours past the latest start, night → `charge_current`.
- [ ] AC9 — Guarantee, off-peak, `isDaylight` null or `getSunlight` absent → spec 005 current.
- [ ] AC10 — Owned guarantee at 16 A at night, off-peak ends → back to `charge_current`, still charging.
- [ ] AC11 — In `done`, ten evaluations open no claim (no `claimCapacity` call).
- [ ] AC12 — A person's ON through Sowel whose `state` reading arrives before the order event: held, never stopped.
- [ ] AC13 — The slots show the FR6 labels in English and French.
- [ ] AC14 — Live: on the owner's installation, a plug-in in the evening is adopted and stopped; the next night's guarantee runs at 16 A.

## Edge cases

| Case                                                         | Expected                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| The recipe's own stop, reading still `true` for a moment     | Not adopted: quiet window after the recipe's `state` order        |
| Drawing stops within the 30 s delay                          | Nothing adopted; the delay restarts on the next draw              |
| A start in progress (wake, retry)                            | Not adopted: the start sets ownership itself                      |
| A person's ON in the vendor app or on the charger's buttons  | Adopted (no Sowel order): accepted trade-off                      |
| Charger offline (`vehicle` null)                             | Nothing adopted, nothing changes (spec 001)                       |
| Car refused twice (`gaveUp`), then the charger draws again   | Adopted, then stopped by `done`                                   |
| `max_current` below `charge_current`                         | `max(charge_current, max_current)`: never below the fixed current |
| Night off-peak with a granted surplus budget (none expected) | `max_current` (already the upper bound of the budget)             |
